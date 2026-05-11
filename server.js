import express from "express";
import { WebSocketServer } from "ws";
import WebSocket from "ws";

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const RECEPTIONIST_SCRIPT = `
You are the friendly AI receptionist for U R Grafix.

You ONLY speak English.
Never speak Spanish or any other language unless the caller specifically asks.

You help callers with custom packaging, labels, branding, websites, merch, apparel, and print services.

Start by saying:
"Thanks for calling U R Grafix. I'm Jessica's virtual assistant. What are you working on today?"

Sound warm, confident, and natural.
Keep replies short.
Ask one question at a time.

IMPORTANT conversation rules:
Wait for the caller to fully answer before asking another question.
Do not assume answers if the caller is silent.
Do not invent names, business names, quantities, or contact details.
If you are unsure what the caller said, politely ask them to repeat it.
Only ask one question at a time and wait for a response before continuing.
Do not rush through the intake process.
If there is silence, say: "No problem, take your time. What are you looking for help with today?"

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
If they ask for pricing, say Jessica can follow up with the best option once the details are reviewed.
If they have an existing order, collect their name, order details, and what they need help with.
If they are not a good fit or are just browsing, still be polite and collect the basics.

End by saying:
"Perfect, I’ll pass this along to Jessica so she can follow up."
`;

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

const wss = new WebSocketServer({ server, path: "/media-stream" });

app.get("/", (req, res) => {
  res.send("URGrafix AI Receptionist is running!");
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
  const audioQueue = [];

  const openaiWs = new WebSocket(
    "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview",
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1",
      },
    }
  );

  openaiWs.on("open", () => {
    console.log("Connected to OpenAI realtime");
    openaiReady = true;

    openaiWs.send(JSON.stringify({
      type: "session.update",
      session: {
        voice: "alloy",
        modalities: ["audio", "text"],
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        turn_detection: {
          type: "server_vad",
          threshold: 0.75,
          prefix_padding_ms: 300,
          silence_duration_ms: 900
        },
        instructions: RECEPTIONIST_SCRIPT
      }
    }));

    openaiWs.send(JSON.stringify({
      type: "response.create",
      response: {
        modalities: ["audio", "text"],
        instructions: "Greet the caller in English only. Ask what they are working on today, then wait for their answer."
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
      const data = JSON.parse(message.toString());

      if (data.event === "start") {
        streamSid = data.start.streamSid;
        console.log("Twilio stream started:", streamSid);
      }

      if (data.event === "media") {
        const audioMessage = {
          type: "input_audio_buffer.append",
          audio: data.media.payload,
        };

        if (openaiReady && openaiWs.readyState === WebSocket.OPEN) {
          openaiWs.send(JSON.stringify(audioMessage));
        } else {
          audioQueue.push(audioMessage);
        }
      }

      if (data.event === "stop") {
        console.log("Twilio stream stopped");
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

      if (response.type === "response.audio.delta" && streamSid) {
        twilioWs.send(JSON.stringify({
          event: "media",
          streamSid,
          media: {
            payload: response.delta,
          },
        }));
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
    if (openaiWs.readyState === WebSocket.OPEN) {
      openaiWs.close();
    }
  });
});
