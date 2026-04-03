import { useState, useEffect, useCallback, useRef } from 'react';

export interface PulsarData {
  trust_score: number;
  tick: number;
  active_attack: string | null;
  threat_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  cpu_usage?: number;
  memory_usage?: number;
  network_latency?: number;
  gnss_status?: 'SECURE' | 'WARNING' | 'ATTACK';
}

interface UsePulsarSyncReturn {
  data: PulsarData | null;
  isConnected: boolean;
  error: string | null;
  reconnect: () => void;
}

const WS_URL = 'ws://localhost:8000/ws';
const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;

export function usePulsarSync(): UsePulsarSyncReturn {
  const [data, setData] = useState<PulsarData | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isManualCloseRef = useRef(false);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[PULSAR SYNC] WebSocket bağlantısı kuruldu');
        setIsConnected(true);
        setError(null);
        reconnectAttemptsRef.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          setData({
            trust_score: parsed.trust_score ?? parsed.trustScore ?? 96,
            tick: parsed.tick ?? Date.now(),
            active_attack: parsed.active_attack ?? parsed.activeAttack ?? null,
            threat_level: parsed.threat_level ?? parsed.threatLevel ?? 'LOW',
            cpu_usage: parsed.cpu_usage ?? parsed.cpuUsage,
            memory_usage: parsed.memory_usage ?? parsed.memoryUsage,
            network_latency: parsed.network_latency ?? parsed.networkLatency,
            gnss_status: parsed.gnss_status ?? parsed.gnssStatus ?? 'SECURE',
          });
        } catch (err) {
          console.error('[PULSAR SYNC] Mesaj parse hatası:', err);
        }
      };

      ws.onerror = (err) => {
        console.error('[PULSAR SYNC] WebSocket hatası:', err);
        setError('Bağlantı hatası');
        setIsConnected(false);
      };

      ws.onclose = () => {
        console.log('[PULSAR SYNC] WebSocket kapandı');
        setIsConnected(false);
        wsRef.current = null;

        if (!isManualCloseRef.current && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttemptsRef.current++;
          console.log(`[PULSAR SYNC] Yeniden bağlanma denemesi ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS}`);
          reconnectTimeoutRef.current = setTimeout(() => {
            // eslint-disable-next-line react-hooks/immutability
            connect();
          }, RECONNECT_DELAY);
        }
      };
    } catch (err) {
      console.error('[PULSAR SYNC] Bağlantı kurulum hatası:', err);
      setError('Bağlantı kurulamadı');
    }
  }, []);

  const reconnect = useCallback(() => {
    isManualCloseRef.current = false;
    reconnectAttemptsRef.current = 0;
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    
    if (wsRef.current) {
      isManualCloseRef.current = true;
      wsRef.current.close();
    }
    
    connect();
  }, [connect]);

  useEffect(() => {
    connect();

    return () => {
      isManualCloseRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  return { data, isConnected, error, reconnect };
}
