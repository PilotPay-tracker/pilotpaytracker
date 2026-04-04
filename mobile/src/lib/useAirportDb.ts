/**
 * useAirportDb Hook
 * Provides access to the airport timezone database for Zulu → Local time conversion
 */

import { useQuery } from '@tanstack/react-query';
import { loadAirportDb, DEFAULT_AIRPORT_DB, type AirportDb } from '@/utils/airportDb';

/**
 * Hook to load and access the airport database
 * Returns the database with timezone information for airports
 */
export function useAirportDb() {
  const { data: airportDb, isLoading } = useQuery({
    queryKey: ['airportDb'],
    queryFn: loadAirportDb,
    staleTime: 1000 * 60 * 60, // 1 hour - airport data doesn't change often
    gcTime: 1000 * 60 * 60 * 24, // 24 hours cache
  });

  return {
    airportDb: airportDb ?? DEFAULT_AIRPORT_DB,
    isLoading,
  };
}
