import express from "express";
import cors from "cors";
import { flightsRepository } from "./repositories/flightsRepository";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

const ALPHANUMERIC_PATTERN = /^[0-9a-zA-Z]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

app.get("/flight/:number", (req, res) => {
    const flightNumber = req.params.number;
    const date = req.query.date;

    if (!ALPHANUMERIC_PATTERN.test(flightNumber)) {
        return res.status(400).json({ error: "Flight number must contain only letters and digits" });
    }

    if (date !== undefined && (typeof date !== "string" || !DATE_PATTERN.test(date))) {
        return res.status(400).json({ error: "Date must be in YYYY-MM-DD format" });
    }

    const flights = flightsRepository.findByFlightNumber(flightNumber, date as string | undefined);

    if (flights.length === 0) {
        const suffix = date ? ` on ${date}` : "";
        return res.status(404).json({ error: `Flight ${flightNumber.toUpperCase()} not found${suffix}` });
    }

    res.json(flights.length === 1 ? flights[0] : flights);
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`API running on port ${port}`));