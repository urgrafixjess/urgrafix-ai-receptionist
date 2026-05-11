import express from "express";
import { WebSocketServer } from "ws";
import WebSocket from "ws";
import { Resend } from "resend";

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL;

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

const RECEPTIONIST_SCRIPT = `
You are the friendly AI receptionist for The Label Lady at U R Grafix.

You ONLY speak English.
Never speak Spanish or any other language unless the caller specifically asks.

You are not a general-purpose assistant.
You only help with:
- custom packaging
- labels
- stickers
- branding
- websites
- merch
- apparel
- event displays
- creative print solutions
- related business projects

Do not generate:
- grocery lists
- stories
- roleplay
- repeated letters
- jokes
- games
- unrelated advice
- homework
- coding help
- random lists
- requests for money

Start by saying:
"Thanks for calling The Label Lady at U R Grafix. I’m Jessica’s virtual assistant. What are you working on today?"

Sound warm, calm, confident, and natural.
Keep replies short.
Ask one question at a time.

IMPORTANT conversation rules:
Wait for the caller to fully answer before asking another question.
Do not assume answers if the caller is silent.
Do not invent names, business names, quantities, or contact details.
If you are unsure what the caller said, politely ask them to repeat it.
Only ask one question at a time and wait for a response before continuing.
Do not rush through the intake process.
Allow natural pauses in conversation.
Do not repeat prompts if the caller pauses briefly.
Allow natural silence without speaking over the caller.
Never say "whenever you're ready" repeatedly.
Do not say "got it" unless the caller gave clear useful information.
If the caller begins speaking, immediately stop talking and listen.
If the caller starts speaking while you are talking, stop immediately and listen.
Do not continue your previous sentence if the caller interrupts.
Do not restart the same sentence after being interrupted.

GOODBYE / END CALL RULES:
If the caller says bye, goodbye, thank you bye, I have to go, I'll leave, ciao, take care, or anything that clearly means they are ending the call, do not ask another question.
Say exactly:
"Thanks for calling The Label Lady. Have a great day!"
Then stop talking.

If the caller asks for money, repeats random words, gives nonsense answers, jokes repeatedly, or appears to be testing the system, say exactly:
"It sounds like this may not be related to our services. Thanks for calling The Label Lady, and have a great day!"
Then stop talking.

BACKGROUND NOISE RULES:
If you hear background noise, laughter, music, kids, side conversations, or unclear audio, do not treat it as an answer.
If the caller's answer is unclear, say:
"Sorry, I didn't quite catch that. Could you repeat just that part?"
Do not guess names, business names, numbers, quantities, or deadlines from unclear audio.
If multiple people are talking, ask one person to answer at a time.

BUSINESS LOGIC RULES:
Custom printed packaging projects typically involve production quantities of hundreds or thousands of units.

If a caller gives an unrealistic quantity like only a few bags, politely clarify whether they mean:
- a sample
- labels for blank bags
- a starter quantity
- or a larger production run

Do not accuse callers of trolling.
If a caller appears confused about ordering quantities, help guide them toward realistic options instead of rejecting them.

Your job is to collect:
1. Caller name
2. Business name
3. What they need help with
4. Product type, if packaging or labels
5. Quantity, if they know it
6. Timeline or deadline
7. Budget range, if appropriate
8. Best phone number or email for follow-up

Do not pretend to be Jessica.
Do not give firm pricing.
Never promise turnaround times, pricing, availability, or delivery dates.
Never claim an order is confirmed.
Never say Jessica will call immediately.
If unsure, say Jessica will review the details personally.

If they ask for pricing, say:
"I can help gather the details Jessica needs for an accurate quote. She’ll review everything and follow up with the best option."

End by saying:
"Perfect, I’ll pass this along to Jessica so she can follow up."
`;

async function sendLeadEmail(transcript) {
  if (!resend || !NOTIFICATION_EMAIL) {
    console.log("Email not sent. Missing RESEND_API_KEY or NOTIFICATION_EMAIL.");
    return;
  }

  const transcriptText = transcript.length
    ? transcript.join("\n")
    : "Call ended, but no transcript was captured.";

  const subject = "🔥 New AI Call Lead";

  const html = `
    <h2>🔥 New AI Call Lead</h2>
    <p><strong>Source:</strong> AI Receptionist</p>
    <h3>Transcript</h3>
    <pre style="white-space:pre-wrap;font-family:Arial,sans-serif;background:#f6f6f6;padding:14px;border-radius:8px;">${transcriptText}</pre>
  `;

  try {
    await resend.emails.send({
      from: "AI Receptionist <onboarding@resend.dev>",
      to: NOTIFICATION_EMAIL,
      subject,
      html
    });

    console.log("Lead email sent.");
  } catch (err) {
    console.error("Email send failed:", err.message);
  }
}

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

const wss = new WebSocketServer({ server, path: "/media-stream" });

app.get("/", (req, res) => {
  res.send("AI Receptionist is running!");
});

app.post("/voice", (req, res) => {
  const host = req.headers.host;

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${host}/media-stream" />
  </Connect>
</Response>`;

  res.type("text/xml");
  res.send(twiml);
});

wss.on("connection", (twilioWs) => {
  console.log("Twilio connected");

  let streamSid = null;
  let openaiReady = false;
  let callEmailSent = false;
  let callEnding = false;

  const audioQueue = [];
  const transcript = [];
  let currentAssistantText = "";

  const openaiWs = new WebSocket(
    "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview",
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1"
      }
    }
  );

  async function finishCall() {
    if (callEmailSent) return;
    callEmailSent = true;

    if (currentAssistantText.trim()) {
      transcript.push(`AI: ${currentAssistantText.trim()}`);
      currentAssistantText = "";
    }

    console.log("Final transcript:", transcript);
    await sendLeadEmail(transcript);
  }

  function clearAssistantAudio() {
    if (!streamSid) return;

    try {
      twilioWs.send(JSON.stringify({
        event: "clear",
        streamSid
      }));
    } catch (err) {
      console.error("Failed to clear Twilio audio:", err.message);
    }

    try {
      if (openaiWs.readyState === WebSocket.OPEN) {
        openaiWs.send(JSON.stringify({
          type: "response.cancel"
        }));
      }
    } catch (err) {
      console.error("Failed to cancel OpenAI response:", err.message);
    }
  }

  async function endCallSoon(delayMs = 1800) {
    if (callEnding) return;
    callEnding = true;

    console.log("Ending call soon.");

    setTimeout(async () => {
      await finishCall();

      try {
        if (twilioWs.readyState === WebSocket.OPEN) {
          twilioWs.close();
        }
      } catch (err) {
        console.error("Failed to close Twilio socket:", err.message);
      }

      try {
        if (openaiWs.readyState === WebSocket.OPEN) {
          openaiWs.close();
        }
      } catch (err) {
        console.error("Failed to close OpenAI socket:", err.message);
      }
    }, delayMs);
  }

  function shouldEndFromAssistantText(text) {
    const lower = text.toLowerCase();

    return (
      lower.includes("thanks for calling the label lady") ||
      lower.includes("have a great day") ||
      lower.includes("not be related to our services")
    );
  }

  function callerIsEnding(text) {
    const lower = text.toLowerCase().trim();

    return (
      lower === "bye" ||
      lower === "goodbye" ||
      lower === "bye bye" ||
      lower === "bye-bye" ||
      lower.includes("thank you bye") ||
      lower.includes("thanks bye") ||
      lower.includes("i have to go") ||
      lower.includes("i'll leave") ||
      lower.includes("ill leave") ||
      lower.includes("ciao") ||
      lower.includes("take care")
    );
  }

  function callerLooksLikeTrolling(text) {
    const lower = text.toLowerCase().trim();

    return (
      lower.includes("can i have money") ||
      lower.includes("i have money can i have money") ||
      lower.includes("this concludes public comment") ||
      lower.includes("grocery list") ||
      lower.includes("tell me a story") ||
      lower.includes("repeat after me")
    );
  }

  openaiWs.on("open", () => {
    console.log("Connected to OpenAI realtime");
    openaiReady = true;

    openaiWs.send(JSON.stringify({
      type: "session.update",
      session: {
        voice: "shimmer",
        modalities: ["audio", "text"],
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        input_audio_transcription: {
          model: "whisper-1",
          language: "en"
        },
        turn_detection: {
          type: "server_vad",
          threshold: 0.72,
          prefix_padding_ms: 600,
          silence_duration_ms: 1800
        },
        instructions: RECEPTIONIST_SCRIPT
      }
    }));

    openaiWs.send(JSON.stringify({
      type: "response.create",
      response: {
        modalities: ["audio", "text"],
        instructions:
          "Greet the caller in English only. Ask what they are working on today and wait for their answer before continuing."
      }
    }));

    while (audioQueue.length > 0) {
      openaiWs.send(JSON.stringify(audioQueue.shift()));
    }
  });

  openaiWs.on("error", (err) => {
    console.error("OpenAI WebSocket error:", err.message);
  });

  openaiWs.on("close", () => {
    console.log("OpenAI WebSocket closed");
  });

  twilioWs.on("message", (message) => {
    try {
      if (callEnding) return;

      const data = JSON.parse(message.toString());

      if (data.event === "start") {
        streamSid = data.start.streamSid;
        console.log("Twilio stream started:", streamSid);
      }

      if (data.event === "media") {
        const audioMessage = {
          type: "input_audio_buffer.append",
          audio: data.media.payload
        };

        if (openaiReady && openaiWs.readyState === WebSocket.OPEN) {
          openaiWs.send(JSON.stringify(audioMessage));
        } else {
          audioQueue.push(audioMessage);
        }
      }

      if (data.event === "stop") {
        console.log("Twilio stream stopped");
        finishCall();

        if (openaiWs.readyState === WebSocket.OPEN) {
          openaiWs.close();
        }
      }
    } catch (err) {
      console.error("Twilio message error:", err.message);
    }
  });

  openaiWs.on("message", (message) => {
    try {
      const response = JSON.parse(message.toString());

      if (response.type === "input_audio_buffer.speech_started") {
        clearAssistantAudio();
      }

      if (response.type === "response.audio.delta" && streamSid && !callEnding) {
        twilioWs.send(JSON.stringify({
          event: "media",
          streamSid,
          media: {
            payload: response.delta
          }
        }));
      }

      if (response.type === "response.audio_transcript.delta") {
        currentAssistantText += response.delta;
      }

      if (response.type === "response.audio_transcript.done") {
        if (currentAssistantText.trim()) {
          const finalText = currentAssistantText.trim();
          transcript.push(`AI: ${finalText}`);
          currentAssistantText = "";

          if (shouldEndFromAssistantText(finalText)) {
            console.log("Assistant closing phrase detected.");
            endCallSoon(1800);
          }
        }
      }

      if (response.type === "conversation.item.input_audio_transcription.completed") {
        if (response.transcript && response.transcript.trim()) {
          const callerText = response.transcript.trim();
          transcript.push(`Caller: ${callerText}`);

          if (callerIsEnding(callerText) || callerLooksLikeTrolling(callerText)) {
            console.log("Caller end/troll phrase detected.");

            if (openaiWs.readyState === WebSocket.OPEN && !callEnding) {
              openaiWs.send(JSON.stringify({
                type: "response.create",
                response: {
                  modalities: ["audio", "text"],
                  instructions:
                    callerLooksLikeTrolling(callerText)
                      ? "Say exactly: It sounds like this may not be related to our services. Thanks for calling The Label Lady, and have a great day!"
                      : "Say exactly: Thanks for calling The Label Lady. Have a great day!"
                }
              }));
            }

            endCallSoon(2200);
          }
        }
      }

      if (response.type === "error") {
        console.error("OpenAI error:", JSON.stringify(response.error));
      }
    } catch (err) {
      console.error("OpenAI message error:", err.message);
    }
  });

  twilioWs.on("close", () => {
    console.log("Twilio disconnected");
    finishCall();

    if (openaiWs.readyState === WebSocket.OPEN) {
      openaiWs.close();
    }
  });
});
