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

    openaiWs.send(
      JSON.stringify({
        type: "session.update",
        session: {
          voice: "alloy",
          instructions:
            "You are the friendly AI receptionist for URGrafix. You help customers with custom packaging, labels, branding, websites, merch, and print services. Be warm, conversational, and concise.",
          modalities: ["audio", "text"],
        },
      })
    );
  });

  twilioWs.on("message", (message) => {
    const data = JSON.parse(message.toString());

    if (data.event === "media") {
      openaiWs.send(
        JSON.stringify({
          type: "input_audio_buffer.append",
          audio: data.media.payload,
        })
      );
    }
  });

  openaiWs.on("message", (message) => {
    const response = JSON.parse(message.toString());

    if (response.type === "response.audio.delta") {
      twilioWs.send(
        JSON.stringify({
          event: "media",
          media: {
            payload: response.delta,
          },
        })
      );
    }
  });

  twilioWs.on("close", () => {
    openaiWs.close();
  });
});
