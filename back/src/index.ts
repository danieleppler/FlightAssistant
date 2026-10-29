import "dotenv/config";
import express from "express";
import cors from "cors";
import { flightsRepository } from "./repositories/flightsRepository";
import { isValidFlightNumber, isValidDateFormat, isValidFlightStatus, FLIGHT_STATUSES } from "./validators/flightInput";
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
    const { message, booking_number: bookingNumber, date, status } = req.body ?? {};

    if (typeof message !== "string" || message.trim().length === 0) {
        return res.status(400).json({ error: "message is required and must be a non-empty string" });
    }

    if (typeof bookingNumber !== "string" || !isValidFlightNumber(bookingNumber)) {
        return res.status(400).json({ error: "booking_number is required and must contain only letters and digits" });
    }

    if (typeof date !== "string" || !isValidDateFormat(date)) {
        return res.status(400).json({ error: "date is required and must be in YYYY-MM-DD format" });
    }

    if (typeof status !== "string" || !isValidFlightStatus(status)) {
        return res.status(400).json({ error: `status is required and must be one of: ${FLIGHT_STATUSES.join(", ")}` });
    }

    if (flightsRepository.findByFlightNumber(bookingNumber, date).length === 0) {
        return res.status(404).json({ error: `Booking ${bookingNumber.toUpperCase()} not found on ${date}` });
    }

    console.log(`[chat] booking_number=${bookingNumber} date=${date} status=${status} message=${JSON.stringify(message)}`);

    try {
        const reply = await runAgent(message, bookingNumber, date, status);
        res.json({ reply });
    } catch (err) {
        console.error("Agent error:", err);
        res.status(500).json({ error: "Failed to process the request" });
    }
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`API running on port ${port}`));