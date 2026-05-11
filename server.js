import express from "express";
import { WebSocketServer } from "ws";

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const server = app.listen(process.env.PORT || 3000, () => {
  console.log("URGrafix AI Receptionist server running");
});

const wss = new WebSocketServer({ server, path: "/media-stream" });

app.get("/", (req, res) => {
  res.send("URGrafix AI Receptionist is running!");
});

app.post("/voice", (req, res) => {
  const host = req.headers.host;

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Thanks for calling U R Grafix. Connecting you to the AI receptionist now.</Say>
  <Connect>
    <Stream url="wss://${host}/media-stream" />
  </Connect>
</Response>`;

  res.type("text/xml");
  res.send(twiml);
});

wss.on("connection", (ws) => {
  console.log("Twilio media stream connected");

  ws.on("message", (message) => {
    const data = JSON.parse(message.toString());

    if (data.event === "start") {
      console.log("Call started:", data.start.callSid);
    }

    if (data.event === "media") {
      // Audio is arriving here. Next step: connect this to OpenAI.
    }

    if (data.event === "stop") {
      console.log("Call ended");
    }
  });

  ws.on("close", () => {
    console.log("Twilio media stream disconnected");
  });
});
