export const TEAM_COLORS: Record<string, string> = {
    "Red Bull Racing": "#0600EF",
    "Mercedes": "#00D2BE",
    "Ferrari": "#E10600",
    "McLaren": "#FF8700",
    "Aston Martin": "#006F62",
    "Alpine": "#0090FF",
    "Williams": "#005AFF",
    "RB": "#2B4562",
    "Haas": "#FFFFFF",
    "Kick Sauber": "#52E252",
    "Renault": "#FFF500",
    "Racing Point": "#F596C8",
    "AlphaTauri": "#2B4562",
    "Alfa Romeo": "#900000"
}

export const DRIVER_TO_TEAM: Record<string, string> = {
    // 2024 Grid
    "VER": "Red Bull Racing", "Max Verstappen": "Red Bull Racing",
    "PER": "Red Bull Racing", "Sergio Perez": "Red Bull Racing",
    "HAM": "Mercedes", "Lewis Hamilton": "Mercedes",
    "RUS": "Mercedes", "George Russell": "Mercedes",
    "LEC": "Ferrari", "Charles Leclerc": "Ferrari",
    "SAI": "Ferrari", "Carlos Sainz": "Ferrari",
    "NOR": "McLaren", "Lando Norris": "McLaren",
    "PIA": "McLaren", "Oscar Piastri": "McLaren",
    "ALO": "Aston Martin", "Fernando Alonso": "Aston Martin",
    "STR": "Aston Martin", "Lance Stroll": "Aston Martin",
    "GAS": "Alpine", "Pierre Gasly": "Alpine",
    "OCO": "Alpine", "Esteban Ocon": "Alpine",
    "ALB": "Williams", "Alex Albon": "Williams",
    "SAR": "Williams", "Logan Sargeant": "Williams",
    "TSU": "RB", "Yuki Tsunoda": "RB",
    "RIC": "RB", "Daniel Ricciardo": "RB",
    "MAG": "Haas", "Kevin Magnussen": "Haas",
    "HUL": "Haas", "Nico Hulkenberg": "Haas",
    "BOT": "Kick Sauber", "Valtteri Bottas": "Kick Sauber",
    "ZHO": "Kick Sauber", "Zhou Guanyu": "Kick Sauber"
}

export function getDriverColor(driverNameOrCode: string): string {
    const team = DRIVER_TO_TEAM[driverNameOrCode] || DRIVER_TO_TEAM[driverNameOrCode.toUpperCase()]
    if (team) {
        return TEAM_COLORS[team]
    }
    // Fallback: Check if common names match partial
    const found = Object.keys(DRIVER_TO_TEAM).find(k =>
        driverNameOrCode.toLowerCase().includes(k.toLowerCase())
    )
    if (found) {
        return TEAM_COLORS[DRIVER_TO_TEAM[found]]
    }
    return "#FFFFFF" // Default white
}
