// server.js - Backend seguro para gestión de roles de administrador y tareas
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());
app.use(express.static('public'));

// Configurar CSP para permitir SheetJS CDN
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdn.sheetjs.com; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.supabase.co;"
  );
  next();
});

const SUPABASE_URL = process.env.SUPABASE_URL ? process.env.SUPABASE_URL.trim() : '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ? process.env.SUPABASE_ANON_KEY.trim() : '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ? process.env.SUPABASE_SERVICE_ROLE_KEY.trim() : '';
const SUPABASE_KEY = process.env.SUPABASE_KEY ? process.env.SUPABASE_KEY.trim() : '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_KEY) {
  console.error('ERROR: Faltan variables de entorno requeridas');
  process.exit(1);
}

console.log('Iniciando servidor con Supabase URL:', SUPABASE_URL);
// Verificación de seguridad de claves (sin revelarlas)
if (SUPABASE_SERVICE_ROLE_KEY === SUPABASE_ANON_KEY) {
  console.warn('⚠️ ADVERTENCIA CRÍTICA: SUPABASE_SERVICE_ROLE_KEY es igual a la ANON_KEY. Las operaciones administrativas fallarán.');
}
console.log('Service Role Key cargada:', SUPABASE_SERVICE_ROLE_KEY ? `SÍ (Inicio: ${SUPABASE_SERVICE_ROLE_KEY.substring(0, 5)}...)` : 'NO');

// ---------------------------------------------------------------------
// Supabase clients
// ---------------------------------------------------------------------
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  db: { schema: 'public' }
});

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  },
  db: { schema: 'public' }
});

// Verificación de conectividad Admin al inicio
(async () => {
  try {
    const { error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (error) {
      console.error('❌ ERROR CRÍTICO DE CONFIGURACIÓN: La SUPABASE_SERVICE_ROLE_KEY es inválida o expiró.');
      console.error('   Detalle del error:', error.message);
    } else {
      console.log('✅ Conexión Supabase Admin verificada correctamente.');
    }
  } catch (e) {
    console.error('❌ Error al verificar conexión Admin:', e.message);
  }
})();

// --- SISTEMA DE CACHÉ EN MEMORIA ---
const apiCache = {
  stats: { data: null, timestamp: 0, ttl: 60 * 1000 }, // 1 minuto para dashboard
  charts: { data: null, timestamp: 0, ttl: 5 * 60 * 1000 } // 5 minutos para reportes
};

// ---------------------------------------------------------------------
// Helpers de autenticación / roles
// ---------------------------------------------------------------------
async function getUserFromToken(accessToken) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) {
    throw new Error('Token inválido o expirado');
  }
  const data = await response.json();
  // Supabase puede devolver { user: {...} } o solo el user
  return data.user || data;
}

async function isUserAdmin(userId) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`isUserAdmin falló para ${userId}:`, response.status, errorText);
    throw new Error('No se pudo verificar el usuario');
  }

  const data = await response.json();
  const user = data.user || data;
  const appMeta = user.app_metadata || {};

  // Usar convención recomendada: app_metadata.role
  return appMeta.role === 'admin' || appMeta.is_super_admin === true;
}

async function updateAdminStatus(targetUserId, makeAdmin) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${targetUserId}`, {
    method: 'PUT',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user_metadata: {},
      app_metadata: {
        role: makeAdmin ? 'admin' : 'user',
        // Mantener compatibilidad con lo que ya tenías
        is_super_admin: makeAdmin,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Error actualizando usuario: ${error}`);
  }

  return await response.json();
}

// Middleware de autenticación
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No se proporcionó token de autorización' });
  }

  const token = authHeader.substring(7);
  try {
    const user = await getUserFromToken(token);
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Sesión no válida' });
  }
}

// ============================================================================
// AUTENTICACIÓN: LOGIN
// ============================================================================
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son obligatorios' });
    }

    const { data: signInData, error: signInError } = await supabaseAdmin.auth.signInWithPassword({
      email,
      password
    });

    if (signInError || !signInData.session) {
      console.error('Error en signInWithPassword:', signInError);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const { session, user } = signInData;
    const accessToken = session.access_token;
    const userId = user.id;

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role, status')
      .eq('id', userId)
      .maybeSingle();

    if (profileError) {
      console.error('Error obteniendo perfil:', profileError);
    }

    // Priorizar app_metadata.role para coherencia con el sistema de permisos
    const appMeta = user.app_metadata || {};
    const role = appMeta.role || profile?.role || 'user';
    const status = profile?.status || 'active';

    if (status !== 'active') {
      return res.status(403).json({ error: 'Usuario inactivo o bloqueado' });
    }

    // Verificar admin usando app_metadata (consistente con isUserAdmin)
    const esSuperAdmin = appMeta.role === 'admin' || appMeta.is_super_admin === true;

    return res.json({
      ok: true,
      accessToken,
      user: {
        id: userId,
        email: user.email,
        role,
        status,
        isSuperAdmin: esSuperAdmin,
      },
    });
  } catch (e) {
    console.error('Error en /api/login:', e);
    return res.status(500).json({ error: 'Error interno en login' });
  }
});

// ---------------------------------------------------------------------
// Endpoints de administración
// ---------------------------------------------------------------------
app.post('/admin/set-admin', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No se proporcionó token de autorización' });
    }
    const accessToken = authHeader.substring(7);
    const { targetUserId, makeAdmin } = req.body;

    if (!targetUserId || typeof makeAdmin !== 'boolean') {
      return res.status(400).json({
        error: 'Parámetros inválidos. Se requiere targetUserId (string) y makeAdmin (boolean)',
      });
    }

    const callerUser = await getUserFromToken(accessToken);
    console.log(`Solicitud de ${callerUser.email} para cambiar rol de usuario ${targetUserId}`);

    const callerIsAdmin = await isUserAdmin(callerUser.id);
    if (!callerIsAdmin) {
      console.warn(`Usuario ${callerUser.email} intentó cambiar roles sin ser administrador`);
      return res.status(403).json({
        error: 'No tienes permisos de administrador para realizar esta acción',
      });
    }

    if (callerUser.id === targetUserId && !makeAdmin) {
      return res.status(400).json({
        error: 'No puedes quitarte tus propios permisos de administrador',
      });
    }

    const updatedUser = await updateAdminStatus(targetUserId, makeAdmin);
    console.log(
      `✓ Usuario ${callerUser.email} ${makeAdmin ? 'promovió' : 'revocó'} permisos admin de usuario ${targetUserId}`
    );

    res.json({
      success: true,
      message: makeAdmin ? 'Usuario promovido a administrador' : 'Permisos de administrador revocados',
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        is_super_admin: makeAdmin,
      },
    });
  } catch (error) {
    console.error('Error en /admin/set-admin:', error);
    res.status(500).json({
      error: error.message || 'Error interno del servidor',
    });
  }
});

app.get('/admin/check', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ isAdmin: false });
    }
    const accessToken = authHeader.substring(7);
    const user = await getUserFromToken(accessToken);
    const isAdmin = await isUserAdmin(user.id);

    res.json({
      isAdmin,
      user: {
        id: user.id,
        email: user.email,
      },
    });
  } catch (error) {
    res.status(401).json({ isAdmin: false, error: error.message });
  }
});

// ---------------------------------------------------------------------
// Endpoints de configuración y health
// ---------------------------------------------------------------------
app.get('/config', (req, res) => {
  res.json({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------
// Endpoints de tareas / expedientes legacy
// ---------------------------------------------------------------------
app.get('/api/tareas', async (req, res) => {
  try {
    const { gestorId, estado, vencenHoy } = req.query;
    let query = supabase.from('expedientes').select('*');

    if (gestorId) query = query.eq('gestor_id', gestorId);
    if (estado) query = query.eq('estado', estado);
    if (vencenHoy === 'true') {
      const hoy = new Date();
      const iso = hoy.toISOString().slice(0, 10);
      query = query.eq('fecha_seguimiento', iso);
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/tareas/:id', requireAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const cambios = req.body;
    const estadosFinales = [
      'Finalizado - Recobro total',
      'Finalizado - Recobro parcial',
      'Rehusado',
      'Datos no válidos',
    ];

    if (estadosFinales.includes(cambios.estado)) {
      const { data: expData, error: getErr } = await supabaseAdmin
        .from('expedientes')
        .select('*')
        .eq('id', id)
        .single();

      if (getErr) return res.status(500).json({ error: getErr.message });

      const archivado = {
        ...expData,
        ...cambios,
        motivo_archivo: cambios.estado,
      };

      const { error: insErr } = await supabaseAdmin
        .from('expedientes_archivados')
        .insert(archivado);

      if (insErr) return res.status(500).json({ error: insErr.message });

      await supabaseAdmin.from('expedientes').delete().eq('id', id);
      return res.json({ ok: true, archivado: true });
    }

    const { data, error } = await supabase
      .from('expedientes')
      .update(cambios)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// ---------------------------------------------------------------------
// Búsqueda, duplicados, archivados y reportes
// ---------------------------------------------------------------------
app.get('/api/expedientes/buscar', requireAuth, async (req, res) => {
  try {
    const { expediente, poliza, sgr, dni } = req.query;
    let query = supabase.from('expedientes').select('*');
    
    if (expediente) query = query.ilike('num_siniestro', `%${expediente}%`);
    if (poliza) query = query.ilike('num_poliza', `%${poliza}%`);
    if (sgr) query = query.ilike('num_sgr', `%${sgr}%`);
    if (dni) query = query.ilike('dni', `%${dni}%`);
    
    const { data, error } = await query.limit(100);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/duplicados/verificar', requireAuth, async (req, res) => {
  try {
    const { expedientes } = req.body;
    if (!Array.isArray(expedientes)) {
      return res.status(400).json({ error: 'Se requiere un array de expedientes' });
    }
    
    const duplicados = [];
    for (const exp of expedientes) {
      const numSiniestro = exp.num_siniestro || exp.numero_expediente;
      const numPoliza = exp.num_poliza || exp.numero_poliza;

      const { data, error } = await supabaseAdmin
        .from('expedientes')
        .select('*')
        .or(`num_siniestro.eq.${numSiniestro},num_poliza.eq.${numPoliza},dni.eq.${exp.dni}`);
      
      if (error) continue;
      if (data && data.length > 0) {
        duplicados.push({
          nuevo: exp,
          existente: data[0],
          motivo: 'Coincide expediente, póliza o DNI'
        });
      }
    }
    
    res.json({ duplicados, total: duplicados.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/archivados', requireAuth, async (req, res) => {
  try {
    const { motivo, desde, hasta, limite = 50 } = req.query;
    let query = supabaseAdmin.from('expedientes_archivados').select('*');
    
    if (motivo) query = query.eq('motivo_archivo', motivo);
    if (desde) query = query.gte('fecha_archivo', desde);
if (hasta) query = query.lte('fecha_archivo', hasta);
query = query.order('fecha_archivo', { ascending: false }).limit(parseInt(limite));

    
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/archivados/:id/restaurar', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data: archivado, error: getErr } = await supabaseAdmin
      .from('expedientes_archivados')
      .select('*')
      .eq('id', id)
      .single();
    
    if (getErr) return res.status(500).json({ error: getErr.message });
    
    const { error: insErr } = await supabaseAdmin
      .from('expedientes')
      .insert({
        ...archivado,
        estado: 'En proceso'
      });
    
    if (insErr) return res.status(500).json({ error: insErr.message });
    
    await supabaseAdmin.from('expedientes_archivados').delete().eq('id', id);
    
    res.json({ ok: true, message: 'Expediente restaurado correctamente' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Endpoint optimizado para estadísticas del Dashboard (evita RLS y descarga masiva)
app.get('/api/dashboard/stats', requireAuth, async (req, res) => {
  try {
    // Verificar caché
    const now = Date.now();
    if (apiCache.stats.data && (now - apiCache.stats.timestamp < apiCache.stats.ttl)) {
      return res.json(apiCache.stats.data);
    }

    const today = new Date().toISOString().split('T')[0];
    
    // Optimización: Realizar una única consulta para obtener todos los estados y fechas
    // Esto reduce 4 llamadas HTTP a 1, mejorando significativamente la latencia.
    let expedientes = [];
    
    // Intentamos consulta optimizada. Si falla (ej: columna renombrada/faltante), usamos fallback.
    const { data: optimizedData, error: optimizedError } = await supabaseAdmin
      .from('expedientes')
      .select('estado, fecha_seguimiento, gestor_id')
      .limit(50000); // Límite alto para asegurar traer todos

    if (optimizedError) {
        console.warn('Aviso: Consulta optimizada de stats falló, usando fallback:', optimizedError.message);
        const { data: fallbackData, error: fallbackError } = await supabaseAdmin
            .from('expedientes')
            .select('*') // Select * es seguro porque ignora columnas que no existen
            .limit(50000);
        if (fallbackError) throw fallbackError;
        expedientes = fallbackData || [];
    } else {
        expedientes = optimizedData || [];
    }

    // Obtener perfiles para mapear nombres en el desglose de urgentes
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, email');
    
    const userMap = new Map();
    if (profiles) {
      profiles.forEach(p => userMap.set(p.id, p.full_name || p.email));
    }

    const stats = {
      total: 0,
      pendientes: 0,
      enProceso: 0,
      vencimientoHoy: 0,
      urgentesPorUsuario: {}
    };

    if (expedientes && expedientes.length > 0) {
      stats.total = expedientes.length;
      
      const pendientesStates = new Set(['Pdte. revisión', 'Pendiente']);
      const enProcesoStates = new Set(['En Proceso', 'En gestión']);
      const closedStates = new Set(['Completado', 'Archivado', 'Finalizado', 'Finalizado Parcial', 'Rehusado', 'Datos NO válidos']);

      for (const exp of expedientes) {
        const estado = exp.estado || '';
        
        if (pendientesStates.has(estado)) stats.pendientes++;
        else if (enProcesoStates.has(estado)) stats.enProceso++;
        
        if (exp.fecha_seguimiento && exp.fecha_seguimiento <= today && !closedStates.has(estado)) {
          stats.vencimientoHoy++;
          
          // Desglose de urgentes por usuario
          const userName = exp.gestor_id ? (userMap.get(exp.gestor_id) || 'Desconocido') : 'Sin Asignar';
          stats.urgentesPorUsuario[userName] = (stats.urgentesPorUsuario[userName] || 0) + 1;
        }
      }
    }

    // Actualizar caché
    apiCache.stats.data = stats;
    apiCache.stats.timestamp = now;

    res.json(stats);
  } catch (e) {
    console.error('Error en /api/dashboard/stats:', e);
    res.status(500).json({ error: e.message });
  }
});

// Endpoint para datos de GRÁFICOS (Reportes) - Optimizado
app.get('/api/reports/charts', requireAuth, async (req, res) => {
  try {
    // Verificar caché
    const now = Date.now();
    if (apiCache.charts.data && (now - apiCache.charts.timestamp < apiCache.charts.ttl)) {
      return res.json(apiCache.charts.data);
    }

    // Optimización: Seleccionar solo columnas necesarias para agrupar
    const { data: expedientes, error } = await supabaseAdmin
      .from('expedientes')
      .select('estado, fecha_ocurrencia');

    if (error) throw error;

    const statusStats = {};
    const monthlyStats = {};

    (expedientes || []).forEach(exp => {
      // Status
      const status = exp.estado || 'Sin estado';
      statusStats[status] = (statusStats[status] || 0) + 1;

      // Monthly
      const dateStr = exp.fecha_ocurrencia;
      if (dateStr) {
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
          const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          monthlyStats[key] = (monthlyStats[key] || 0) + 1;
        }
      }
    });

    const result = {
      status: statusStats,
      monthly: monthlyStats
    };

    // Actualizar caché
    apiCache.charts.data = result;
    apiCache.charts.timestamp = now;

    res.json(result);
  } catch (e) {
    console.error('Error en /api/reports/charts:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/reportes/estadisticas', async (req, res) => {
  try {
    let queryTotal = supabase.from('expedientes').select('*', { count: 'exact', head: true });
    const { count: total } = await queryTotal;
    
    const estados = ['Pendiente', 'En proceso', 'Finalizado', 'Archivado'];
    const porEstado = {};
    
    for (const estado of estados) {
      const { count } = await supabase
        .from('expedientes')
        .select('*', { count: 'exact', head: true })
        .eq('estado', estado);
      porEstado[estado] = count || 0;
    }
    
    const { count: archivados } = await supabase
      .from('expedientes_archivados')
      .select('*', { count: 'exact', head: true });
    
    res.json({
      total,
      porEstado,
      archivados,
      fecha_generacion: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/expedientes/importar', requireAuth, async (req, res) => {
  try {
    const { expedientes, opciones, fileName } = req.body;
    
    if (!Array.isArray(expedientes)) {
      return res.status(400).json({ error: 'Se requiere un array de expedientes' });
    }
    
    const resultados = {
      exitosos: [],
      duplicados: [],
      errores: []
    };
    
    for (const exp of expedientes) {
      try {
        // Validación básica del registro
        if (!exp || typeof exp !== 'object') {
            throw new Error('El registro no es un objeto válido');
        }

        // Determinar el identificador (soporte para num_siniestro o numero_expediente)
        const idExpediente = exp.num_siniestro || exp.numero_expediente;
        if (!idExpediente) {
            throw new Error('El expediente no tiene número de siniestro/expediente');
        }

        if (opciones?.verificarDuplicados) {
          // Usar el nombre de columna que coincida con la propiedad del objeto
          const columnaBusqueda = exp.num_siniestro ? 'num_siniestro' : 'numero_expediente';

          const { data: existe, error: searchError } = await supabaseAdmin
            .from('expedientes')
            .select('id')
            .eq(columnaBusqueda, idExpediente)
            .maybeSingle();
          
          if (searchError) {
             throw new Error(`Error al verificar duplicados: ${searchError.message}`);
          }
          
          if (existe) {
            resultados.duplicados.push(exp);
            continue;
          }
        }
        
        const { data, error } = await supabaseAdmin
          .from('expedientes')
          .insert(exp)
          .select()
          .single();
        
        if (error) throw error;
        resultados.exitosos.push(data);
      } catch (err) {
        resultados.errores.push({
          expediente: exp,
          error: err.message
        });
      }
    }
    
    // Registrar log de importación en el servidor
    if (fileName) {
      await supabaseAdmin.from('import_logs').insert({
        file_name: fileName,
        total_records: expedientes.length,
        duplicates_count: resultados.duplicados.length, // Duplicados detectados por el backend
        status: resultados.errores.length > 0 ? 'Con Errores' : 'Completado',
        created_at: new Date().toISOString()
      });
    }
    
    res.json(resultados);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// CRUD COMPLETO DE EXPEDIENTES
// ============================================================================
app.get('/api/expedientes', requireAuth, async (req, res) => {
  try {
    const { gestor_id, estado, buscar, fecha_desde, fecha_hasta, ordenarPor, orden, limite = 100, offset = 0, campos,
            importe_min, importe_max, cia_causante, tipo_dano, asegurado } = req.query;
    
    const seleccion = campos || '*';
    let query = supabase.from('expedientes').select(seleccion, { count: 'exact' });
    
    if (gestor_id) query = query.eq('gestor_id', gestor_id);
    if (estado) {
      if (typeof estado === 'string' && estado.includes(',')) {
        query = query.in('estado', estado.split(',').map(e => e.trim()));
      } else {
        query = query.eq('estado', estado);
      }
    }
    if (fecha_desde) query = query.gte('fecha_ocurrencia', fecha_desde);
    if (fecha_hasta) query = query.lte('fecha_ocurrencia', fecha_hasta);
    
    if (importe_min) query = query.gte('importe', importe_min);
    if (importe_max) query = query.lte('importe', importe_max);
    if (cia_causante && cia_causante.trim()) query = query.ilike('cia_causante', `%${cia_causante.trim()}%`);
    if (tipo_dano && tipo_dano.trim()) query = query.ilike('tipo_dano', `%${tipo_dano.trim()}%`);
    if (asegurado && asegurado.trim()) query = query.ilike('nombre_asegurado', `%${asegurado.trim()}%`);

    if (buscar) {
      query = query.or(
        `num_siniestro.ilike.%${buscar}%,` +
        `num_poliza.ilike.%${buscar}%,` +
        `num_sgr.ilike.%${buscar}%,` +
        `dni.ilike.%${buscar}%,` +
        `nombre_asegurado.ilike.%${buscar}%`
      );
    }
    
    const columnaOrden = ordenarPor || 'id';
    const esAscendente = orden === 'asc';
    
    query = query.order(columnaOrden, { ascending: esAscendente })
      .range(parseInt(offset), parseInt(offset) + parseInt(limite) - 1);
    
    const { data, error, count } = await query;
    
    if (error) return res.status(500).json({ error: error.message });
    
    res.json({
      data,
      total: count,
      limite: parseInt(limite),
      offset: parseInt(offset)
    });
  } catch (e) {
    console.error('Error en GET /api/expedientes:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/expedientes/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data, error } = await supabase
      .from('expedientes')
      .select('*, seguimientos(*)')
      .eq('id', id)
      .single();
    
    if (error) return res.status(404).json({ error: 'Expediente no encontrado' });
    
    // Ordenar seguimientos por fecha descendente (más reciente primero)
    if (data.seguimientos && Array.isArray(data.seguimientos)) {
      data.seguimientos.sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0));
    }

    res.json(data);
  } catch (e) {
    console.error('Error en GET /api/expedientes/:id:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/expedientes', requireAuth, async (req, res) => {
  try {
    const expediente = req.body;
    
    const numSiniestro = expediente.num_siniestro || expediente.numero_expediente;
    if (!numSiniestro) {
      return res.status(400).json({ error: 'El número de expediente es obligatorio' });
    }
    
    const { data: existe } = await supabase
      .from('expedientes')
      .select('id')
      .eq('num_siniestro', numSiniestro)
      .maybeSingle();
    
    if (existe) {
      return res.status(409).json({ 
        error: 'Ya existe un expediente con ese número',
        expediente_existente_id: existe.id
      });
    }
    
 const { data, error } = await supabase
  .from('expedientes')
  .insert({
    ...expediente,
    estado: expediente.estado || 'Pendiente'
  })
  .select()
  .single();
    
    if (error) return res.status(500).json({ error: error.message });
    
    res.status(201).json(data);
  } catch (e) {
    console.error('Error en POST /api/expedientes:', e);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/expedientes/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const cambios = req.body;
    
    const { data, error } = await supabase
      .from('expedientes')
      .update({
        ...cambios,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Expediente no encontrado' });
      }
      return res.status(500).json({ error: error.message });
    }
    
    res.json(data);
  } catch (e) {
    console.error('Error en PUT /api/expedientes/:id:', e);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/expedientes/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data: expediente, error: getError } = await supabaseAdmin
      .from('expedientes')
      .select('*')
      .eq('id', id)
      .single();
    
    if (getError) return res.status(404).json({ error: 'Expediente no encontrado' });
    
    await supabaseAdmin
      .from('expedientes_archivados')
      .insert({
        ...expediente,
        motivo_archivo: 'Eliminado manualmente',
        fecha_archivo: new Date().toISOString()
      });
    
    const { error: deleteError } = await supabaseAdmin
      .from('expedientes')
      .delete()
      .eq('id', id);
    
    if (deleteError) return res.status(500).json({ error: deleteError.message });
    
    res.json({ ok: true, message: 'Expediente eliminado correctamente' });
  } catch (e) {
    console.error('Error en DELETE /api/expedientes/:id:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/expedientes/:id/seguimientos', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data, error } = await supabase
      .from('seguimientos')
      .select('*')
      .eq('expediente_id', id)
      .order('fecha', { ascending: false });
    
    if (error) return res.status(500).json({ error: error.message });
    
    res.json(data || []);
  } catch (e) {
    console.error('Error en GET /api/expedientes/:id/seguimientos:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/expedientes/:id/seguimientos', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { comentario, tipo, usuario_id } = req.body;
    
    if (!comentario) {
      return res.status(400).json({ error: 'El comentario es obligatorio' });
    }
    
    const { data, error } = await supabase
      .from('seguimientos')
      .insert({
        expediente_id: id,
        comentario,
        tipo: tipo || 'nota',
        usuario_id: usuario_id || null,
        fecha: new Date().toISOString()
      })
      .select()
      .single();
    
    if (error) return res.status(500).json({ error: error.message });
    
    res.status(201).json(data);
  } catch (e) {
    console.error('Error en POST /api/expedientes/:id/seguimientos:', e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// ADMIN: CREACIÓN DE USUARIOS
// ============================================================================
// ============================================================================
// API: RESPONSABLES (GESTORES)
// ============================================================================
// Endpoint para obtener lista de responsables (gestores) para dropdowns
// Accesible para usuarios autenticados (no requiere ser admin)
app.get('/api/responsables', requireAuth, async (req, res) => {
  try {
    console.log('DEBUG: /api/responsables - Solicitado por:', req.user?.email);
    
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.listUsers({ 
      page: 1, 
      perPage: 1000 
    });
    
    if (authError) {
      console.error('Error obteniendo usuarios de Auth:', authError);
      throw new Error(`Auth Error: ${authError.message}`);
    }
    
    // Mapear solo campos necesarios para dropdowns/selects
    const responsables = (authData?.users || [])
      .map(u => ({
        id: u.id,
        full_name: u.user_metadata?.full_name || u.email.split('@')[0],
        email: u.email,
        status: u.user_metadata?.status || 'active'
      }))
      .filter(u => u.status === 'active')
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
    
    console.log('DEBUG: /api/responsables - Devolviendo', responsables.length, 'responsables');
    res.json(responsables);
  } catch (e) {
    console.error('Error en GET /api/responsables:', e);
    res.status(500).json({ error: e.message });
  }
});

// Endpoint para OBTENER todos los usuarios (GET)
app.get('/admin/users', requireAuth, async (req, res) => {
  try {
    const user = req.user;

    // Verificar que el usuario es admin
    const isSuperAdmin = user.email === 'jesus.mp@gescon360.es';
    if (!isSuperAdmin) {
      // Verificar en app_metadata en lugar de la tabla profiles
      const appMeta = user.app_metadata || {};
      if (appMeta.role !== 'admin' && appMeta.is_super_admin !== true) {
        return res.status(403).json({ error: 'Solo administradores pueden ver usuarios' });
      }
    }

    // Usar SOLO Auth Admin API (que funciona sin problemas RLS)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.listUsers({ 
      page: 1, 
      perPage: 1000 
    });
    
    if (authError) throw new Error(`Auth Error: ${authError.message}`);
    
    // Mapear usuarios de Auth a estructura de perfil
    const profiles = (authData?.users || []).map(u => ({
      id: u.id,
      email: u.email,
      full_name: u.user_metadata?.full_name || u.email.split('@')[0],
      role: u.app_metadata?.role || (u.app_metadata?.is_super_admin ? 'admin' : (u.user_metadata?.role || 'user')),
      status: u.user_metadata?.status || 'active',
      created_at: u.created_at
    }));
    
    console.log('DEBUG: /admin/users GET - Devolviendo', profiles.length, 'usuarios');
    res.json(profiles);
  } catch (e) {
    console.error('Error en GET /admin/users:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/admin/users', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) {
      return res.status(401).json({ error: 'Token de autenticación no proporcionado' });
    }

    let user;
    try {
      user = await getUserFromToken(token);
      console.log('DEBUG: /admin/users - User ID:', user.id, 'Email:', user.email);
    } catch (e) {
      console.error('DEBUG: getUserFromToken falló:', e.message);
      return res.status(401).json({ error: 'Sesión no válida' });
    }

    // Permitir siempre al super admin (jesus.mp@gescon360.es) incluso si falla el perfil
    const isSuperAdmin = user.email === 'jesus.mp@gescon360.es';

    if (!isSuperAdmin) {
      const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();

      console.log('DEBUG: /admin/users - Profile check:', { userId: user.id, profileFound: !!profile, role: profile?.role, error: profileError?.message });

      if (profileError || !profile || profile.role !== 'admin') {
        return res.status(403).json({ error: 'Solo administradores pueden crear usuarios' });
      }
    }

    const { email, fullName, role } = req.body || {};
    if (!email || !role) {
      return res.status(400).json({ error: 'Email y rol son obligatorios' });
    }

    if (!email.endsWith('@gescon360.es')) {
      return res.status(400).json({ error: 'El email debe pertenecer al dominio @gescon360.es' });
    }

    if (!['admin', 'user'].includes(role)) {
      return res.status(400).json({ error: 'Rol no válido. Debe ser "admin" o "user"' });
    }

    const tempPassword = generateStrongPassword();

    console.log('DEBUG: Intentando crear usuario con service_role...');
    const { data: createdUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      app_metadata: {
        role: role,
      },
      user_metadata: {
        full_name: fullName || email.split('@')[0],
      }
    });

    if (createError) {
      console.error('DEBUG: createUser falló:', createError.message, createError.status);
      
      // Si el usuario ya existe, intentamos recuperar su perfil o crearlo
      if (createError.message?.includes('already registered') || createError.status === 422) {
         const { data: { users: authUsers }, error: listError } = await supabaseAdmin.auth.admin.listUsers();
         if (!listError && authUsers) {
             const existing = authUsers.find(u => u.email === email);
             if (existing) {
                 // Upsert del perfil para asegurar que existe en la tabla profiles
                 const { error: upsertError } = await supabaseAdmin
                    .from('profiles')
                    .upsert({
                        id: existing.id,
                        email: email,
                        full_name: fullName || email.split('@')[0],
                        role: role,
                        status: 'active'
                    });
                 
                 if (upsertError) {
                     return res.status(500).json({ error: 'Usuario existe en Auth pero falló al crear perfil: ' + upsertError.message });
                 }
                 return res.json({ message: 'Usuario ya existía. Perfil actualizado correctamente.', email, role });
             }
         }
      }
      return res.status(500).json({ error: `No se pudo crear el usuario en Supabase Auth: ${createError.message}` });
    }

    const userId = createdUser.user?.id;
    console.log('DEBUG: Usuario creado en Auth con ID:', userId);

    const { error: profileUpsertError } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: userId,
        email,
        full_name: fullName || email.split('@')[0],
        role,
        status: 'active'
      });

    if (profileUpsertError) {
      console.error('Error actualizando perfil:', profileUpsertError);
    }

    return res.json({
      message: 'Usuario creado correctamente',
      email,
      role,
      tempPassword
    });
  } catch (e) {
    console.error('Error en /admin/users:', e);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Endpoint para OBTENER un usuario específico (GET)
app.get('/admin/users/:id', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    const targetUserId = req.params.id;

    // Verificar permisos
    const isSuperAdmin = user.email === 'jesus.mp@gescon360.es';
    if (!isSuperAdmin) {
       const appMeta = user.app_metadata || {};
       if (appMeta.role !== 'admin' && appMeta.is_super_admin !== true) {
         return res.status(403).json({ error: 'Solo administradores pueden ver detalles de usuarios' });
       }
    }

    // Obtener de Auth (fuente de verdad para roles/status)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.getUserById(targetUserId);
    
    if (authError) throw authError;
    if (!authData.user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const u = authData.user;
    const userData = {
        id: u.id,
        email: u.email,
        full_name: u.user_metadata?.full_name || '',
        role: u.app_metadata?.role || 'user',
        status: u.user_metadata?.status || 'active'
    };

    res.json(userData);
  } catch (e) {
    console.error('Error en GET /admin/users/:id:', e);
    res.status(500).json({ error: e.message });
  }
});

// Endpoint para ELIMINAR usuario (DELETE)
app.delete('/admin/users/:id', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    const targetUserId = req.params.id;

    // Verificar que el usuario es admin
    const isSuperAdmin = user.email === 'jesus.mp@gescon360.es';
    if (!isSuperAdmin) {
      const appMeta = user.app_metadata || {};
      if (appMeta.role !== 'admin' && appMeta.is_super_admin !== true) {
        return res.status(403).json({ error: 'Solo administradores pueden eliminar usuarios' });
      }
    }

    if (user.id === targetUserId) {
      return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
    }

    console.log(`DEBUG: Eliminando usuario ${targetUserId} solicitado por ${user.email}`);

    // 0. Obtener datos del perfil antes de borrar (para limpiar tareas por nombre/email)
    const { data: targetProfile } = await supabaseAdmin
        .from('profiles')
        .select('full_name, email')
        .eq('id', targetUserId)
        .single();

    // 1. Desvincular expedientes (gestor_id) para evitar errores de integridad referencial
    await supabaseAdmin.from('expedientes').update({ gestor_id: null }).eq('gestor_id', targetUserId);

    // 2. Desvincular seguimientos (usuario_id)
    await supabaseAdmin.from('seguimientos').update({ usuario_id: null }).eq('usuario_id', targetUserId);

    // 3. Desvincular tareas (responsable es texto: nombre o email)
    if (targetProfile) {
        if (targetProfile.full_name) await supabaseAdmin.from('tareas').update({ responsable: null }).eq('responsable', targetProfile.full_name);
        if (targetProfile.email) await supabaseAdmin.from('tareas').update({ responsable: null }).eq('responsable', targetProfile.email);
    }

    // 4. Eliminar de profiles PRIMERO (para evitar error de FK si no hay CASCADE en auth.users)
    const { error: deleteProfileError } = await supabaseAdmin
        .from('profiles')
        .delete()
        .eq('id', targetUserId);

    if (deleteProfileError) {
        console.warn('Aviso: Error al eliminar perfil (posiblemente dependencias o ya eliminado):', deleteProfileError.message);
    }

    // 5. Eliminar de Auth (Supabase Auth)
    const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(targetUserId);
    
    if (deleteAuthError) {
      throw new Error(`Error eliminando usuario de Auth: ${deleteAuthError.message}`);
    }

    res.json({ message: 'Usuario eliminado correctamente' });
  } catch (e) {
    console.error('Error en DELETE /admin/users:', e);
    res.status(500).json({ error: e.message });
  }
});

// Endpoint para ACTUALIZAR usuario (PUT) - Perfil y Estado
app.put('/admin/users/:id', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    const targetUserId = req.params.id;
    const { fullName, role, status } = req.body;

    // Verificar permisos
    const isSuperAdmin = user.email === 'jesus.mp@gescon360.es';
    if (!isSuperAdmin) {
       const appMeta = user.app_metadata || {};
       if (appMeta.role !== 'admin' && appMeta.is_super_admin !== true) {
         return res.status(403).json({ error: 'Solo administradores pueden editar usuarios' });
       }
    }

    // 1. Actualizar Auth Metadata (para sincronizar status y nombre en /api/responsables)
    const updates = {
        user_metadata: {},
        app_metadata: {}
    };
    if (fullName) updates.user_metadata.full_name = fullName;
    if (status) updates.user_metadata.status = status;
    if (role) updates.app_metadata.role = role;

    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
        targetUserId,
        updates
    );
    if (authError) throw new Error(`Auth update error: ${authError.message}`);

    // 2. Actualizar Profile
    const profileUpdates = {};
    if (fullName) profileUpdates.full_name = fullName;
    if (role) profileUpdates.role = role;
    if (status) profileUpdates.status = status;

    const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .update(profileUpdates)
        .eq('id', targetUserId);

    if (profileError) throw new Error(`Profile update error: ${profileError.message}`);

    res.json({ message: 'Usuario actualizado correctamente' });
  } catch (e) {
    console.error('Error en PUT /admin/users/:id:', e);
    res.status(500).json({ error: e.message });
  }
});

// Endpoint para REDISTRIBUCIÓN AUTOMÁTICA de tareas (Expedientes)
app.post('/admin/redistribute-tasks', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    
    // Solo admins pueden redistribuir
    const isSuperAdmin = user.email === 'jesus.mp@gescon360.es';
    if (!isSuperAdmin) {
      const appMeta = user.app_metadata || {};
      if (appMeta.role !== 'admin' && appMeta.is_super_admin !== true) {
        return res.status(403).json({ error: 'Solo administradores pueden redistribuir tareas' });
      }
    }

    // 1. Obtener usuarios no disponibles (vacation, sick_leave, permit, inactive)
    const { data: unavailableUsers, error: unavailError } = await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name, status')
      .in('status', ['vacation', 'sick_leave', 'permit', 'inactive']);

    if (unavailError) throw unavailError;

    // 2. Obtener usuarios activos
    const { data: activeUsers, error: activeError } = await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name')
      .eq('status', 'active')
      .eq('role', 'user'); // Solo usuarios normales, no admins

    if (activeError || !activeUsers || activeUsers.length === 0) {
      return res.json({
        ok: true,
        message: 'No hay usuarios activos para redistribuir tareas',
        redistributed: 0
      });
    }

    let totalRedistributed = 0;
    const redistribution = [];

    // 3. Para cada usuario no disponible, redistribuir sus tareas
    for (const unavailUser of (unavailableUsers || [])) {
      // Obtener tareas pendientes del usuario no disponible
      const { data: tasks, error: tasksError } = await supabaseAdmin
        .from('expedientes')
        .select('*')
        .eq('gestor_id', unavailUser.id)
        .in('estado', ['Pendiente', 'En proceso']);

      if (tasksError || !tasks || tasks.length === 0) continue;

      // Distribuir equitativamente entre usuarios activos
      for (let i = 0; i < tasks.length; i++) {
        const targetUser = activeUsers[i % activeUsers.length];
        
        const { error: updateError } = await supabaseAdmin
          .from('expedientes')
          .update({ gestor_id: targetUser.id })
          .eq('id', tasks[i].id);

        if (!updateError) {
          totalRedistributed++;
          
          // Actualizar también la tabla 'tareas' para reflejar el cambio en la UI
          const exp = tasks[i];
          const numSiniestro = exp.num_siniestro || exp.numero_expediente;
          if (numSiniestro) {
             const targetName = targetUser.full_name || targetUser.email;
             await supabaseAdmin
               .from('tareas')
               .update({ responsable: targetName })
               .eq('num_siniestro', numSiniestro)
               .not('estado', 'in', '("Completada","Archivado","Recobrado")');
          }

          redistribution.push({
            taskId: tasks[i].id,
            from: unavailUser.email,
            to: targetUser.email
          });
        }
      }
    }

    console.log(`✓ Redistribuidas ${totalRedistributed} tareas automáticamente`);

    res.json({
      ok: true,
      message: `${totalRedistributed} tareas redistribuidas correctamente`,
      redistributed: totalRedistributed,
      details: redistribution
    });

  } catch (e) {
    console.error('Error en redistribución automática:', e);
    res.status(500).json({ error: e.message });
  }
});

// Endpoint para REBALANCEO DE CARGA ACTIVA (Nivelación entre usuarios activos)
app.post('/admin/rebalance-workload', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    
    // Verificar permisos
    const isSuperAdmin = user.email === 'jesus.mp@gescon360.es';
    if (!isSuperAdmin) {
      const appMeta = user.app_metadata || {};
      if (appMeta.role !== 'admin' && appMeta.is_super_admin !== true) {
        return res.status(403).json({ error: 'Solo administradores pueden rebalancear carga' });
      }
    }

    // 1. Obtener usuarios activos (candidatos)
    const { data: activeUsers, error: usersError } = await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name')
      .eq('status', 'active')
      .eq('role', 'user'); // Solo usuarios estándar

    if (usersError) throw usersError;
    if (!activeUsers || activeUsers.length < 2) {
      return res.json({ success: false, message: 'Se necesitan al menos 2 usuarios activos para rebalancear.' });
    }

    // 2. Obtener expedientes activos asignados
    const { data: expedientes, error: expError } = await supabaseAdmin
      .from('expedientes')
      .select('id, gestor_id, num_siniestro, fecha_seguimiento')
      .in('estado', ['Pendiente', 'En proceso', 'Pdte. revisión', 'En gestión'])
      .not('gestor_id', 'is', null);

    if (expError) throw expError;

    // Definir fecha límite para no mover urgentes (Hoy + Mañana)
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const limitStr = tomorrow.toISOString().split('T')[0];

    // 3. Calcular carga
    const workload = {};
    activeUsers.forEach(u => workload[u.id] = { total: 0, movable: [] });
    
    const activeUserIds = new Set(activeUsers.map(u => u.id));
    expedientes.forEach(exp => {
        if (activeUserIds.has(exp.gestor_id)) {
            const isUrgent = exp.fecha_seguimiento && exp.fecha_seguimiento <= limitStr;
            workload[exp.gestor_id].total++;
            if (!isUrgent) workload[exp.gestor_id].movable.push(exp);
        }
    });

    const totalTasks = Object.values(workload).reduce((acc, obj) => acc + obj.total, 0);
    const average = Math.floor(totalTasks / activeUsers.length);

    // 4. Identificar movimientos (Sobrecargados -> Subcargados)
    const overloaded = [];
    const underloaded = [];

    activeUsers.forEach(u => {
        const load = workload[u.id];
        if (load.total > average) {
            overloaded.push({ user: u, tasks: load.movable, excess: load.total - average });
        } else if (load.total < average) {
            underloaded.push({ user: u, deficit: average - load.total });
        }
    });

    let movedCount = 0;

    // 5. Redistribuir
    for (const source of overloaded) {
        while (source.excess > 0 && source.tasks.length > 0 && underloaded.length > 0) {
            const target = underloaded[0];
            const expToMove = source.tasks.pop(); // Tomar uno del exceso
            
            const { error: updateError } = await supabaseAdmin
                .from('expedientes')
                .update({ gestor_id: target.user.id })
                .eq('id', expToMove.id);

            if (!updateError) {
                movedCount++;
                // Sincronizar Tareas
                const numSiniestro = expToMove.num_siniestro;
                if (numSiniestro) {
                    const targetName = target.user.full_name || target.user.email;
                    await supabaseAdmin
                        .from('tareas')
                        .update({ responsable: targetName })
                        .eq('num_siniestro', numSiniestro)
                        .not('estado', 'in', '("Completada","Archivado","Recobrado")');
                }
            }

            source.excess--;
            target.deficit--;

            if (target.deficit === 0) underloaded.shift();
        }
    }

    res.json({ 
        success: true, 
        message: `Rebalanceo completado. Se movieron ${movedCount} expedientes. Promedio aprox: ${average}.` 
    });

  } catch (e) {
    console.error('Error en rebalanceo:', e);
    res.status(500).json({ error: e.message });
  }
});

// Endpoint para REDISTRIBUIR tareas de usuarios no disponibles
app.post('/admin/tasks/redistribute', requireAuth, async (req, res) => {
  try {
    // 1. Obtener usuarios NO DISPONIBLES
    const { data: unavailableUsers, error: uError } = await supabaseAdmin
        .from('profiles')
        .select('full_name, email')
        .in('status', ['inactive', 'vacation', 'sick_leave', 'permit']);

    if (uError) throw uError;
    if (!unavailableUsers || unavailableUsers.length === 0) return res.json({ message: 'No hay usuarios no disponibles.' });

    const unavailableNames = unavailableUsers.flatMap(u => [u.full_name, u.email]).filter(Boolean);

    // 2. Obtener usuarios ACTIVOS
    const { data: activeUsers, error: aError } = await supabaseAdmin
        .from('profiles')
        .select('full_name, email')
        .eq('status', 'active');

    if (aError) throw aError;
    if (!activeUsers || activeUsers.length === 0) return res.status(400).json({ error: 'No hay usuarios activos para recibir tareas.' });

    // 3. Buscar y redistribuir tareas pendientes
    const { data: tasks } = await supabaseAdmin
        .from('tareas')
        .select('id')
        .in('responsable', unavailableNames)
        .not('estado', 'in', '("Completada","Recobrado","Archivado","Rehusado NO cobertura")');

    if (!tasks || tasks.length === 0) return res.json({ message: 'No hay tareas pendientes para redistribuir.' });

    const updates = tasks.map((task, i) => {
        const target = activeUsers[i % activeUsers.length];
        return supabaseAdmin.from('tareas').update({ responsable: target.full_name || target.email }).eq('id', task.id);
    });

    await Promise.all(updates);
    res.json({ success: true, message: `Se redistribuyeron ${tasks.length} tareas entre ${activeUsers.length} usuarios activos.` });
  } catch (e) {
    console.error('Error redistribuyendo:', e);
    res.status(500).json({ error: e.message });
  }
});

// Endpoint para REASIGNAR CARGA DE TRABAJO (Expedientes y Tareas)
app.post('/admin/reassign-workload', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    const { sourceUserId, targetUserId } = req.body;

    // Verificar permisos de admin
    const isSuperAdmin = user.email === 'jesus.mp@gescon360.es';
    if (!isSuperAdmin) {
      const appMeta = user.app_metadata || {};
      if (appMeta.role !== 'admin' && appMeta.is_super_admin !== true) {
        return res.status(403).json({ error: 'Solo administradores pueden reasignar carga de trabajo' });
      }
    }

    if (!sourceUserId || !targetUserId) {
      return res.status(400).json({ error: 'IDs de origen y destino requeridos' });
    }

    if (sourceUserId === targetUserId) {
      return res.status(400).json({ error: 'El usuario de origen y destino no pueden ser el mismo' });
    }

    // Obtener perfiles para manejar la reasignación de tareas (que usa texto)
    const { data: sourceProfile } = await supabaseAdmin.from('profiles').select('full_name, email').eq('id', sourceUserId).single();
    const { data: targetProfile } = await supabaseAdmin.from('profiles').select('full_name, email').eq('id', targetUserId).single();

    if (!targetProfile) return res.status(404).json({ error: 'Usuario destino no encontrado' });

    // 1. Reasignar Expedientes (gestor_id)
    const { data: movedExps, error: expError } = await supabaseAdmin
      .from('expedientes')
      .update({ gestor_id: targetUserId })
      .eq('gestor_id', sourceUserId)
      .select('num_siniestro');

    if (expError) throw new Error(`Error reasignando expedientes: ${expError.message}`);
    const expCount = movedExps ? movedExps.length : 0;

    // 2. Reasignar Tareas (responsable es texto)
    let tasksCount = 0;
    if (sourceProfile) {
       const targetName = targetProfile.full_name || targetProfile.email;
       // Actualizar por nombre o email
       const searchTerms = [sourceProfile.full_name, sourceProfile.email].filter(Boolean);
       const movedSiniestros = movedExps ? movedExps.map(e => e.num_siniestro).filter(Boolean) : [];
       
       // A. Actualizar tareas vinculadas a los expedientes movidos (Prioridad)
       if (movedSiniestros.length > 0) {
         const { count } = await supabaseAdmin
            .from('tareas')
            .update({ responsable: targetName })
            .in('num_siniestro', movedSiniestros)
            .select('id', { count: 'exact' });
         tasksCount += (count || 0);
       }

       // B. Actualizar tareas restantes por coincidencia de nombre (Fallback)
       if (searchTerms.length > 0) {
         const { count } = await supabaseAdmin
            .from('tareas')
            .update({ responsable: targetName })
            .in('responsable', searchTerms)
            .neq('responsable', targetName) // Evitar re-contar las ya actualizadas
            .select('id', { count: 'exact' });
         tasksCount += (count || 0);
       }
    }

    res.json({ 
      success: true, 
      message: `Reasignación completada. Expedientes transferidos: ${expCount || 0}. Tareas transferidas: ${tasksCount}.` 
    });

  } catch (e) {
    console.error('Error en /admin/reassign-workload:', e);
    res.status(500).json({ error: e.message });
  }
});

// Endpoint de utilidad para migrar roles de 'profiles' a 'app_metadata'
app.post('/admin/migrate-roles', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    // Protección extra: solo el super admin principal puede ejecutar esto
    if (user.email !== 'jesus.mp@gescon360.es') {
      return res.status(403).json({ error: 'Acceso denegado. Solo super admin.' });
    }

    // 1. Obtener todos los perfiles que tienen rol
    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from('profiles')
      .select('id, role');

    if (profilesError) throw new Error(profilesError.message);

    const stats = { total: (profiles || []).length, updated: 0, errors: [] };

    // 2. Actualizar cada usuario en Auth
    for (const p of (profiles || [])) {
      if (!p.role) continue;
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
        p.id,
        { app_metadata: { role: p.role } }
      );
      
      if (updateError) stats.errors.push({ id: p.id, error: updateError.message });
      else stats.updated++;
    }

    res.json({ message: 'Migración finalizada', stats });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function generateStrongPassword(length = 12) {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return password;
}

// ---------------------------------------------------------------------
// CRUD Clientes
// ---------------------------------------------------------------------
app.get('/api/clientes', async (req, res) => {
  try {
    const { buscar, limite = 50, offset = 0 } = req.query;
    let query = supabase.from('clientes').select('*');
    if (buscar) query = query.or(`nombre.ilike.%${buscar}%,apellidos.ilike.%${buscar}%,dni.ilike.%${buscar}%,email.ilike.%${buscar}%`);
    query = query
  .order('id', { ascending: false })
  .range(parseInt(offset), parseInt(offset) + parseInt(limite) - 1);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/clientes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase.from('clientes').select('*').eq('id', id).single();
    if (error) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/clientes', async (req, res) => {
  try {
    const { data, error } = await supabase.from('clientes').insert(req.body).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/clientes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase.from('clientes').update(req.body).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/clientes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('clientes').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, message: 'Cliente eliminado' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------
// CRUD Pólizas
// ---------------------------------------------------------------------
app.get('/api/polizas', async (req, res) => {
  try {
    const { cliente_id, buscar, limite = 50 } = req.query;
    let query = supabase.from('polizas').select('*');
    if (cliente_id) query = query.eq('cliente_id', cliente_id);
    if (buscar) query = query.or(`numero_poliza.ilike.%${buscar}%,compania.ilike.%${buscar}%`);
   query = query.order('id', { ascending: false }).limit(parseInt(limite));
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/polizas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase.from('polizas').select('*').eq('id', id).single();
    if (error) return res.status(404).json({ error: 'Póliza no encontrada' });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/polizas', async (req, res) => {
  try {
    const { data, error } = await supabase.from('polizas').insert(req.body).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/polizas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase.from('polizas').update(req.body).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/polizas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('polizas').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, message: 'Póliza eliminada' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------
// CRUD Siniestros
// ---------------------------------------------------------------------
app.get('/api/siniestros', async (req, res) => {
  try {
    const { poliza_id, buscar, limite = 50 } = req.query;
    let query = supabase.from('siniestros').select('*');
    if (poliza_id) query = query.eq('poliza_id', poliza_id);
    if (buscar) query = query.or(`numero_siniestro.ilike.%${buscar}%,descripcion.ilike.%${buscar}%`);
    query = query.order('id', { ascending: false }).limit(parseInt(limite));
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/siniestros/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase.from('siniestros').select('*').eq('id', id).single();
    if (error) return res.status(404).json({ error: 'Siniestro no encontrado' });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/siniestros', async (req, res) => {
  try {
    const { data, error } = await supabase.from('siniestros').insert(req.body).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/siniestros/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase.from('siniestros').update(req.body).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/siniestros/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('siniestros').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, message: 'Siniestro eliminado' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------
// Arranque del servidor
// ---------------------------------------------------------------------
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en puerto ${PORT}`);
  console.log('📍 Endpoints disponibles:');
  console.log('  AUTH:');
  console.log('   POST /api/login');
  console.log('   POST /admin/set-admin');
  console.log('   GET  /admin/check');
  console.log('   POST /admin/users');
  console.log('   GET  /api/responsables');
  console.log('');
  console.log('  EXPEDIENTES:');
  console.log('   GET    /api/expedientes');
  console.log('   GET    /api/expedientes/:id');
  console.log('   POST   /api/expedientes');
  console.log('   PUT    /api/expedientes/:id');
  console.log('   DELETE /api/expedientes/:id');
  console.log('   GET    /api/expedientes/:id/seguimientos');
  console.log('   POST   /api/expedientes/:id/seguimientos');
  console.log('   GET    /api/expedientes/buscar');
  console.log('   POST   /api/expedientes/importar');
  console.log('');
  console.log('  TAREAS (legacy):');
  console.log('   GET   /api/tareas');
  console.log('   PATCH /api/tareas/:id');
  console.log('');
  console.log('  ARCHIVADOS & REPORTES:');
  console.log('   GET  /api/archivados');
  console.log('   POST /api/archivados/:id/restaurar');
  console.log('   POST /api/duplicados/verificar');
  console.log('   GET  /api/reportes/estadisticas');
  console.log('');
  console.log('  CLIENTES:');
  console.log('   GET    /api/clientes');
  console.log('   GET    /api/clientes/:id');
  console.log('   POST   /api/clientes');
  console.log('   PUT    /api/clientes/:id');
  console.log('   DELETE /api/clientes/:id');
  console.log('');
  console.log('  PÓLIZAS:');
  console.log('   GET    /api/polizas');
  console.log('   GET    /api/polizas/:id');
  console.log('   POST   /api/polizas');
  console.log('   PUT    /api/polizas/:id');
  console.log('   DELETE /api/polizas/:id');
  console.log('');
  console.log('  SINIESTROS:');
  console.log('   GET    /api/siniestros');
  console.log('   GET    /api/siniestros/:id');
  console.log('   POST   /api/siniestros');
  console.log('   PUT    /api/siniestros/:id');
  console.log('   DELETE /api/siniestros/:id');
  console.log('');
  console.log('  SYSTEM:');
  console.log('   GET /config');
  console.log('   GET /health');
});
