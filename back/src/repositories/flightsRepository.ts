import { readFileSync } from "fs";
import { join } from "path";

export interface Airport {
  code: string;
  city: string;
  city_he: string;
}

export interface Flight {
  id: string;
  flight_number: string;
  date: string;
  origin: Airport;
  destination: Airport;
  scheduled_departure: string;
  scheduled_arrival: string;
  estimated_departure: string | null;
  estimated_arrival: string | null;
  status: string;
  delay_minutes: number;
  disruption_reason: string | null;
  terminal: string;
  gate: string | null;
  aircraft: string;
  seats_left: { economy: number; business: number };
  diverted_to?: Airport;
}

export interface IFlightsRepository {
  findByFlightNumber(flightNumber: string, date?: string): Flight[];
  findByRoute(originCode: string, destinationCode: string): Flight[];
  findByDate(date: string): Flight[];
}

const flightsData: { flights: Flight[] } = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "data", "flights.json"), "utf-8")
);

class FlightsRepository implements IFlightsRepository {
  findByFlightNumber(flightNumber: string, date?: string): Flight[] {
    const normalized = flightNumber.toUpperCase();
    return flightsData.flights.filter(
      (f) => f.flight_number === normalized && (!date || f.date === date)
    );
  }

  findByRoute(originCode: string, destinationCode: string): Flight[] {
    return flightsData.flights.filter(
      (f) => f.origin.code === originCode && f.destination.code === destinationCode
    );
  }

  findByDate(date: string): Flight[] {
    return flightsData.flights.filter((f) => f.date === date);
  }
}

export const flightsRepository: IFlightsRepository = new FlightsRepository();
