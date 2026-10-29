import "dotenv/config";
import express from "express";
import cors from "cors";
import { flightsRepository } from "./repositories/flightsRepository";
import { isValidFlightNumber, isValidDateFormat } from "./validators/flightInput";
import { runAgent } from "./agent/agent";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/flight/:number", (req, res) => {
    const flightNumber = req.params.number;
    const date = req.query.date;

    if (!isValidFlightNumber(flightNumber)) {
        return res.status(400).json({ error: "Flight number must contain only letters and digits" });
    }

    if (date !== undefined && (typeof date !== "string" || !isValidDateFormat(date))) {
        return res.status(400).json({ error: "Date must be in YYYY-MM-DD format" });
    }

    const flights = flightsRepository.findByFlightNumber(flightNumber, date as string | undefined);

    if (flights.length === 0) {
        const suffix = date ? ` on ${date}` : "";
        return res.status(404).json({ error: `Flight ${flightNumber.toUpperCase()} not found${suffix}` });
    }

    res.json(flights.length === 1 ? flights[0] : flights);
});

app.post("/chat", async (req, res) => {
    const { message } = req.body ?? {};

    if (typeof message !== "string" || message.trim().length === 0) {
        return res.status(400).json({ error: "message is required and must be a non-empty string" });
    }

    try {
        const reply = await runAgent(message);
        res.json({ reply });
    } catch (err) {
        console.error("Agent error:", err);
        res.status(500).json({ error: "Failed to process the request" });
    }
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`API running on port ${port}`));