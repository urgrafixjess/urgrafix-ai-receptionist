import express from "express";

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

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

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`URGrafix AI Receptionist server running on port ${PORT}`);
});
