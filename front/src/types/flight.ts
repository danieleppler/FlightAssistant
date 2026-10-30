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
