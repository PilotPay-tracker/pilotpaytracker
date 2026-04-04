// src/lib/oooi/store.ts
// Main store for trips, duty days, and legs with OOOI tracking

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  type Trip,
  type DutyDay,
  type Leg,
  type OOOITimes,
  type ParseMethod,
  generateTripId,
  generateDutyDayId,
  generateLegId,
  computeOOOITimes,
  computeDutyDayCredit,
  computeTripTotals,
} from './types';

interface OOOIStore {
  trips: Trip[];
  currentTripId: string | null;

  // Trip actions
  addTrip: (trip: Omit<Trip, 'id' | 'lastUpdated'>) => string;
  updateTrip: (tripId: string, updates: Partial<Trip>) => void;
  deleteTrip: (tripId: string) => void;
  setCurrentTrip: (tripId: string | null) => void;

  // Duty Day actions
  addDutyDay: (tripId: string, dutyDay: Omit<DutyDay, 'id'>) => string;
  updateDutyDay: (tripId: string, dutyDayId: string, updates: Partial<DutyDay>) => void;
  deleteDutyDay: (tripId: string, dutyDayId: string) => void;

  // Leg actions
  addLeg: (tripId: string, dutyDayId: string, leg: Omit<Leg, 'id'>) => string;
  updateLeg: (tripId: string, dutyDayId: string, legId: string, updates: Partial<Leg>) => void;
  deleteLeg: (tripId: string, dutyDayId: string, legId: string) => void;

  // OOOI specific actions
  updateLegOOOI: (
    tripId: string,
    dutyDayId: string,
    legId: string,
    times: Partial<OOOITimes>,
    parseMethod?: ParseMethod,
    confidence?: number
  ) => void;

  // Queries
  getTrip: (tripId: string) => Trip | undefined;
  getDutyDay: (tripId: string, dutyDayId: string) => DutyDay | undefined;
  getLeg: (tripId: string, dutyDayId: string, legId: string) => Leg | undefined;
  getCurrentTrip: () => Trip | undefined;
  getActiveTrips: () => Trip[];
  getCompletedTrips: () => Trip[];

  // Recalculation
  recalculateDutyDay: (tripId: string, dutyDayId: string) => void;
  recalculateTrip: (tripId: string) => void;
}

export const useOOOIStore = create<OOOIStore>()(
  persist(
    (set, get) => ({
      trips: [],
      currentTripId: null,

      // Trip actions
      addTrip: (tripData) => {
        const id = generateTripId();
        const newTrip: Trip = {
          ...tripData,
          id,
          lastUpdated: Date.now(),
        };

        set((state) => ({
          trips: [...state.trips, newTrip],
          currentTripId: id,
        }));

        return id;
      },

      updateTrip: (tripId, updates) => {
        set((state) => ({
          trips: state.trips.map((trip) =>
            trip.id === tripId
              ? { ...trip, ...updates, lastUpdated: Date.now() }
              : trip
          ),
        }));
      },

      deleteTrip: (tripId) => {
        set((state) => ({
          trips: state.trips.filter((trip) => trip.id !== tripId),
          currentTripId:
            state.currentTripId === tripId ? null : state.currentTripId,
        }));
      },

      setCurrentTrip: (tripId) => {
        set({ currentTripId: tripId });
      },

      // Duty Day actions
      addDutyDay: (tripId, dutyDayData) => {
        const id = generateDutyDayId();
        const newDutyDay: DutyDay = {
          ...dutyDayData,
          id,
        };

        set((state) => ({
          trips: state.trips.map((trip) =>
            trip.id === tripId
              ? {
                  ...trip,
                  dutyDays: [...trip.dutyDays, newDutyDay],
                  lastUpdated: Date.now(),
                }
              : trip
          ),
        }));

        // Recalculate trip totals
        get().recalculateTrip(tripId);

        return id;
      },

      updateDutyDay: (tripId, dutyDayId, updates) => {
        set((state) => ({
          trips: state.trips.map((trip) =>
            trip.id === tripId
              ? {
                  ...trip,
                  dutyDays: trip.dutyDays.map((dd) =>
                    dd.id === dutyDayId ? { ...dd, ...updates } : dd
                  ),
                  lastUpdated: Date.now(),
                }
              : trip
          ),
        }));

        get().recalculateTrip(tripId);
      },

      deleteDutyDay: (tripId, dutyDayId) => {
        set((state) => ({
          trips: state.trips.map((trip) =>
            trip.id === tripId
              ? {
                  ...trip,
                  dutyDays: trip.dutyDays.filter((dd) => dd.id !== dutyDayId),
                  lastUpdated: Date.now(),
                }
              : trip
          ),
        }));

        get().recalculateTrip(tripId);
      },

      // Leg actions
      addLeg: (tripId, dutyDayId, legData) => {
        const id = generateLegId();
        const newLeg: Leg = {
          ...legData,
          id,
        };

        set((state) => ({
          trips: state.trips.map((trip) =>
            trip.id === tripId
              ? {
                  ...trip,
                  dutyDays: trip.dutyDays.map((dd) =>
                    dd.id === dutyDayId
                      ? { ...dd, legs: [...dd.legs, newLeg] }
                      : dd
                  ),
                  lastUpdated: Date.now(),
                }
              : trip
          ),
        }));

        get().recalculateDutyDay(tripId, dutyDayId);

        return id;
      },

      updateLeg: (tripId, dutyDayId, legId, updates) => {
        set((state) => ({
          trips: state.trips.map((trip) =>
            trip.id === tripId
              ? {
                  ...trip,
                  dutyDays: trip.dutyDays.map((dd) =>
                    dd.id === dutyDayId
                      ? {
                          ...dd,
                          legs: dd.legs.map((leg) =>
                            leg.id === legId ? { ...leg, ...updates } : leg
                          ),
                        }
                      : dd
                  ),
                  lastUpdated: Date.now(),
                }
              : trip
          ),
        }));

        get().recalculateDutyDay(tripId, dutyDayId);
      },

      deleteLeg: (tripId, dutyDayId, legId) => {
        set((state) => ({
          trips: state.trips.map((trip) =>
            trip.id === tripId
              ? {
                  ...trip,
                  dutyDays: trip.dutyDays.map((dd) =>
                    dd.id === dutyDayId
                      ? {
                          ...dd,
                          legs: dd.legs.filter((leg) => leg.id !== legId),
                        }
                      : dd
                  ),
                  lastUpdated: Date.now(),
                }
              : trip
          ),
        }));

        get().recalculateDutyDay(tripId, dutyDayId);
      },

      // OOOI specific actions
      updateLegOOOI: (tripId, dutyDayId, legId, times, parseMethod, confidence) => {
        set((state) => ({
          trips: state.trips.map((trip) =>
            trip.id === tripId
              ? {
                  ...trip,
                  dutyDays: trip.dutyDays.map((dd) =>
                    dd.id === dutyDayId
                      ? {
                          ...dd,
                          legs: dd.legs.map((leg) => {
                            if (leg.id !== legId) return leg;

                            const updatedOOOI: OOOITimes = {
                              ...leg.oopiTimes,
                              ...times,
                            };

                            return {
                              ...leg,
                              oopiTimes: updatedOOOI,
                              computedTimes: computeOOOITimes(updatedOOOI),
                              parseMethod: parseMethod ?? leg.parseMethod,
                              parseConfidence: confidence ?? leg.parseConfidence,
                              lastUpdated: Date.now(),
                            };
                          }),
                        }
                      : dd
                  ),
                  lastUpdated: Date.now(),
                }
              : trip
          ),
        }));

        get().recalculateDutyDay(tripId, dutyDayId);
      },

      // Queries
      getTrip: (tripId) => {
        return get().trips.find((trip) => trip.id === tripId);
      },

      getDutyDay: (tripId, dutyDayId) => {
        const trip = get().trips.find((t) => t.id === tripId);
        return trip?.dutyDays.find((dd) => dd.id === dutyDayId);
      },

      getLeg: (tripId, dutyDayId, legId) => {
        const trip = get().trips.find((t) => t.id === tripId);
        const dutyDay = trip?.dutyDays.find((dd) => dd.id === dutyDayId);
        return dutyDay?.legs.find((leg) => leg.id === legId);
      },

      getCurrentTrip: () => {
        const { trips, currentTripId } = get();
        return trips.find((trip) => trip.id === currentTripId);
      },

      getActiveTrips: () => {
        return get().trips.filter((trip) => !trip.isComplete);
      },

      getCompletedTrips: () => {
        return get().trips.filter((trip) => trip.isComplete);
      },

      // Recalculation
      recalculateDutyDay: (tripId, dutyDayId) => {
        set((state) => ({
          trips: state.trips.map((trip) => {
            if (trip.id !== tripId) return trip;

            const updatedDutyDays = trip.dutyDays.map((dd) => {
              if (dd.id !== dutyDayId) return dd;

              let totalBlockMinutes = 0;
              let totalFlightMinutes = 0;

              for (const leg of dd.legs) {
                if (leg.computedTimes?.blockTime) {
                  totalBlockMinutes += leg.computedTimes.blockTime;
                }
                if (leg.computedTimes?.flightTime) {
                  totalFlightMinutes += leg.computedTimes.flightTime;
                }
              }

              const updatedDutyDay: DutyDay = {
                ...dd,
                totalBlockMinutes,
                totalFlightMinutes,
                totalCreditMinutes: 0, // Will be computed below
              };

              updatedDutyDay.totalCreditMinutes = computeDutyDayCredit(updatedDutyDay);
              updatedDutyDay.minimumCreditApplied =
                updatedDutyDay.totalCreditMinutes > totalBlockMinutes;

              return updatedDutyDay;
            });

            return { ...trip, dutyDays: updatedDutyDays };
          }),
        }));

        get().recalculateTrip(tripId);
      },

      recalculateTrip: (tripId) => {
        set((state) => ({
          trips: state.trips.map((trip) => {
            if (trip.id !== tripId) return trip;

            const totals = computeTripTotals(trip);

            return {
              ...trip,
              ...totals,
              lastUpdated: Date.now(),
            };
          }),
        }));
      },
    }),
    {
      name: 'oooi-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
