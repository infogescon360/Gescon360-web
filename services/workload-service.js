// services/workload-service.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// TODO: Implementar funciones
export const getActiveUsers = async () => {
  // Implementar
};

export const getCurrentWorkloadStats = async () => {
  // Implementar
};

// Exportar todas las funciones
export default {
  getActiveUsers,
  getCurrentWorkloadStats
};
