import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`API running on port ${port}`));