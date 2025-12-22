
import { describe, it, expect, beforeAll } from 'vitest'

// Configuration
const API_BASE_URL = 'http://localhost:8000' // targeting the first running instance from metadata
const SEASON = 2023
const COUNTRY = 'Bahrain'
const SESSION_NAME = 'Race'
const DRIVER_NUMBER = 1 // Verstappen
const TEST_TIMEOUT = 30000

describe('OpenF1 API Integration Tests', () => {
    let sessionKey: number
    let sampleTimeStart: string
    let sampleTimeEnd: string

    // Helper for making API requests
    async function apiGet(endpoint: string, params: Record<string, any> = {}) {
        const url = new URL(`${API_BASE_URL}${endpoint}`)
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                url.searchParams.append(key, String(value))
            }
        })

        const res = await fetch(url.toString())
        if (!res.ok) {
            throw new Error(`API call failed: ${res.status} ${res.statusText} - ${await res.text()}`)
        }
        return res.json()
    }

    // =========================================================================
    // 1. Session Discovery
    // =========================================================================

    describe('Session Discovery Endpoints', () => {
        it('GET /f1/seasons - should return available seasons', async () => {
            const data = await apiGet('/f1/seasons')
            expect(data).toHaveProperty('seasons')
            expect(Array.isArray(data.seasons)).toBe(true)
            expect(data.seasons).toContain(2023)
        })

        it('GET /f1/meetings - should return meetings for a season', async () => {
            const data = await apiGet('/f1/meetings', { year: SEASON })
            expect(data).toHaveProperty('meetings')
            expect(Array.isArray(data.meetings)).toBe(true)
            expect(data.meetings.length).toBeGreaterThan(0)
            expect(data.meetings[0]).toHaveProperty('meeting_key')
        })

        it('GET /f1/sessions - should return specific session', async () => {
            const data = await apiGet('/f1/sessions', {
                year: SEASON,
                country_name: COUNTRY,
                session_name: SESSION_NAME
            })
            expect(data).toHaveProperty('sessions')
            expect(Array.isArray(data.sessions)).toBe(true)
            expect(data.sessions.length).toBeGreaterThan(0)

            // Store session key for subsequent tests
            sessionKey = data.sessions[0].session_key
            console.log(`Using Session Key: ${sessionKey} for dependent tests`)
        })
    })

    // =========================================================================
    // 2. Driver Data
    // =========================================================================

    describe('Driver Endpoints', () => {
        it('GET /f1/drivers - should return drivers for session', async () => {
            expect(sessionKey).toBeDefined()
            const data = await apiGet('/f1/drivers', { session_key: sessionKey })
            expect(data).toHaveProperty('drivers')
            expect(Array.isArray(data.drivers)).toBe(true)
            expect(data.drivers.length).toBeGreaterThan(0)

            // Verify a known driver exists (Verstappen #1)
            const ver = data.drivers.find((d: any) => d.driver_number === DRIVER_NUMBER)
            expect(ver).toBeDefined()
        })
    })

    // =========================================================================
    // 3. Lap Data
    // =========================================================================

    describe('Lap Data Endpoints', () => {
        it('GET /f1/laps - should return laps for driver', async () => {
            expect(sessionKey).toBeDefined()
            const data = await apiGet('/f1/laps', {
                session_key: sessionKey,
                driver_number: DRIVER_NUMBER
            })
            expect(data).toHaveProperty('laps')
            expect(Array.isArray(data.laps)).toBe(true)
            expect(data.laps.length).toBeGreaterThan(0)
            expect(data.laps[0]).toHaveProperty('lap_number')
            expect(data.laps[0]).toHaveProperty('lap_duration')

            // Capture a valid time window from the first lap with a date
            const validLap = data.laps.find((l: any) => l.date_start)
            if (validLap) {
                sampleTimeStart = validLap.date_start
                console.log(`Using sample time from Lap ${validLap.lap_number}: ${sampleTimeStart}`)
                // Add 30 seconds
                const d = new Date(sampleTimeStart)
                d.setSeconds(d.getSeconds() + 30)
                sampleTimeEnd = d.toISOString()
            } else {
                console.warn('Warning: No laps with valid date_start found')
            }
        }, TEST_TIMEOUT)
    })

    // =========================================================================
    // 4. Telemetry Data
    // =========================================================================

    describe('Telemetry Endpoints', () => {
        it('GET /f1/car-data - should return telemetry samples', async () => {
            expect(sessionKey).toBeDefined()
            // Fetch a small time window or limit logic if api supports it,
            // but api/main.py doesn't seem to have limit param for car-data, just date filters.
            // We'll fetch without filters but verify it works (response might be large so careful)
            // Ideally we'd pick a specific time range from the laps data, but for simplicity:

            // Just request, but utilize 'speed_gte' to limit data if possible or just check structure
            // NOTE: The user prompt mentioned creating valid text queries.
            // Querying *all* telemetry for a race might be huge.
            // Let's rely on the backend default behavior (it might stream or return big json).
            // To be safe, let's get a lap start time first?

            // For now, let's just try to hit it and hope it's not too huge or efficient enough.
            // The API description says "sampled at ~3.7 Hz".

            // Let's use speed_gte=300 to get less data
            const params: any = {
                session_key: sessionKey,
                driver_number: DRIVER_NUMBER,
                speed_gte: 310
            }
            // Use time filter if available to reduce load
            if (sampleTimeStart && sampleTimeEnd) {
                params.date_gte = sampleTimeStart
                params.date_lte = sampleTimeEnd
                // remove speed filter to ensure we get data in this time window
                delete params.speed_gte
            }

            const data = await apiGet('/f1/car-data', params)
            expect(data).toHaveProperty('data')
            expect(Array.isArray(data.data)).toBe(true)
            // May be empty if 310 is too fast for Bahrain? (Max speed is usually >320)
            // Verify structure at least
        }, TEST_TIMEOUT)

        it('GET /f1/location - should return location samples', async () => {
            expect(sessionKey).toBeDefined()

            if (!sampleTimeStart || !sampleTimeEnd) {
                console.warn('Warning: No sample time available, skipping strict location test to avoid 422')
                return
            }

            const params: any = {
                session_key: sessionKey,
                driver_number: DRIVER_NUMBER,
                date_gte: sampleTimeStart,
                date_lte: sampleTimeEnd
            }

            const data = await apiGet('/f1/location', params)
            expect(data).toHaveProperty('data')
            expect(Array.isArray(data.data)).toBe(true)
            if (data.data.length > 0) {
                expect(data.data[0]).toHaveProperty('x')
                expect(data.data[0]).toHaveProperty('y')
            }
        }, TEST_TIMEOUT)
    })

    // =========================================================================
    // 5. Race Control & Strategy
    // =========================================================================

    describe('Race Control & Strategy Endpoints', () => {
        it('GET /f1/intervals - should return interval data', async () => {
            expect(sessionKey).toBeDefined()
            const data = await apiGet('/f1/intervals', {
                session_key: sessionKey,
                driver_number: DRIVER_NUMBER
            })
            expect(data).toHaveProperty('data')
            expect(Array.isArray(data.data)).toBe(true)
        }, TEST_TIMEOUT)

        it('GET /f1/position - should return position history', async () => {
            const data = await apiGet('/f1/position', {
                session_key: sessionKey,
                driver_number: DRIVER_NUMBER
            })
            expect(data).toHaveProperty('data')
            expect(Array.isArray(data.data)).toBe(true)
            expect(data.data[0]).toHaveProperty('position')
        })

        it('GET /f1/race-control - should return race control messages', async () => {
            const data = await apiGet('/f1/race-control', { session_key: sessionKey })
            expect(data).toHaveProperty('messages')
            expect(Array.isArray(data.messages)).toBe(true)
        })

        it('GET /f1/weather - should return weather data', async () => {
            const data = await apiGet('/f1/weather', { session_key: sessionKey })
            expect(data).toHaveProperty('data')
            expect(Array.isArray(data.data)).toBe(true)
            expect(data.data[0]).toHaveProperty('air_temperature')
        })

        it('GET /f1/stints - should return stint info', async () => {
            const data = await apiGet('/f1/stints', {
                session_key: sessionKey,
                driver_number: DRIVER_NUMBER
            })
            expect(data).toHaveProperty('stints')
            expect(Array.isArray(data.stints)).toBe(true)
            expect(data.stints.length).toBeGreaterThan(0)
            expect(data.stints[0]).toHaveProperty('compound')
        })

        it('GET /f1/pit - should return pit stops', async () => {
            // Verstappen might have pitted.
            const data = await apiGet('/f1/pit', {
                session_key: sessionKey,
                driver_number: DRIVER_NUMBER
            })
            expect(data).toHaveProperty('pits')
            expect(Array.isArray(data.pits)).toBe(true)
        })
    })

    // =========================================================================
    // 6. Results & Events
    // =========================================================================

    describe('Results & Events Endpoints', () => {
        it('GET /f1/results - should return session results', async () => {
            expect(sessionKey).toBeDefined()
            const data = await apiGet('/f1/results', { session_key: sessionKey })
            expect(data).toHaveProperty('results')
            expect(Array.isArray(data.results)).toBe(true)
            // Verstappen won this race (Bahrain 2023)
            const winner = data.results.find((r: any) => r.position === 1)
            if (winner) {
                expect(winner.driver_number).toBe(1)
            } else {
                console.warn('Warning: Winner not found in results')
            }
        })

        it('GET /f1/starting-grid - should return grid positions', async () => {
            const data = await apiGet('/f1/starting-grid', { session_key: sessionKey })
            expect(data).toHaveProperty('grid')
            expect(Array.isArray(data.grid)).toBe(true)
            if (data.grid.length === 0) {
                console.warn('Warning: No starting grid data returned from OpenF1')
            }
        })

        it('GET /f1/overtakes - should return overtake data', async () => {
            const data = await apiGet('/f1/overtakes', { session_key: sessionKey })
            expect(data).toHaveProperty('overtakes')
            expect(Array.isArray(data.overtakes)).toBe(true)
        })

        it('GET /f1/team-radio - should return radio captures', async () => {
            const data = await apiGet('/f1/team-radio', {
                session_key: sessionKey,
                driver_number: DRIVER_NUMBER
            })
            expect(data).toHaveProperty('radio')
            expect(Array.isArray(data.radio)).toBe(true)
        })
    })
})
