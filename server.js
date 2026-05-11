import express from "express";
import { WebSocketServer } from "ws";
import WebSocket from "ws";

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

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
        instructions: `
You are the friendly AI receptionist for U R Grafix.
You help callers with custom packaging, labels, branding, websites, merch, and print services.
Start by greeting the caller warmly and asking what they are working on.
Ask one question at a time.
Collect their name, business name, service needed, quantity if relevant, deadline, budget range, and best follow-up contact.
Keep responses short and natural.
Do not pretend to be Jessica. Say you are her virtual assistant.
        `
      }
    }));

    openaiWs.send(JSON.stringify({
      type: "response.create"
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
        openaiWs.close();
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
