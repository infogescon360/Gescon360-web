// server.js - Backend seguro para gestión de roles de administrador y tareas
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import crypto from 'crypto'; // Necesario para hash de historial
import nodemailer from 'nodemailer';

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
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'jesus.mp@gescon360.es';
const CRON_SECRET = process.env.CRON_SECRET || 'gescon360_cron_secret_key';

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

// Configuración de Nodemailer para envío de correos
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// --- SISTEMA DE CACHÉ EN MEMORIA ---
const apiCache = {
  stats: { data: null, timestamp: 0, ttl: 60 * 1000 }, // 1 minuto para dashboard
  charts: { data: null, timestamp: 0, ttl: 5 * 60 * 1000 } // 5 minutos para reportes
};

// --- RATE LIMITING (Login) ---
const loginAttempts = new Map(); // Key: IP, Value: { count, lockedUntil }
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_TIME = 15 * 60 * 1000; // 15 minutos

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
    // 1. Rate Limiting Check
    const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const now = Date.now();
    
    if (loginAttempts.has(clientIp)) {
        const attempt = loginAttempts.get(clientIp);
        if (attempt.lockedUntil && attempt.lockedUntil > now) {
            const secondsLeft = Math.ceil((attempt.lockedUntil - now) / 1000);
            return res.status(429).json({ error: `Demasiados intentos fallidos. Por favor, espera ${secondsLeft} segundos.` });
        }
        if (attempt.lockedUntil && attempt.lockedUntil <= now) loginAttempts.delete(clientIp);
    }

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
      
      // 2. Record Failed Attempt
      const attempt = loginAttempts.get(clientIp) || { count: 0, lockedUntil: null };
      attempt.count++;
      if (attempt.count >= MAX_LOGIN_ATTEMPTS) {
          attempt.lockedUntil = Date.now() + LOCKOUT_TIME;
      }
      loginAttempts.set(clientIp, attempt);

      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // 3. Clear Attempts on Success
    loginAttempts.delete(clientIp);

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

    // --- VERIFICACIÓN DE CADUCIDAD DE CONTRASEÑA (2 MESES) ---
    let mustChangePassword = false;
    const lastChange = user.user_metadata?.last_password_change;
    const TWO_MONTHS_MS = 60 * 24 * 60 * 60 * 1000;

    if (lastChange) {
        const lastDate = new Date(lastChange);
        if (Date.now() - lastDate.getTime() > TWO_MONTHS_MS) {
            mustChangePassword = true;
        }
    } else {
        // Si nunca se ha cambiado (o no hay registro), forzamos el cambio inicial por seguridad
        // Opcional: Podrías dar un periodo de gracia basado en created_at
        mustChangePassword = true;
    }

    return res.json({
      ok: true,
      accessToken,
      user: {
        id: userId,
        email: user.email,
        role,
        status,
        isSuperAdmin: esSuperAdmin,
        mustChangePassword // Flag para el frontend
      },
    });
  } catch (e) {
    console.error('Error en /api/login:', e);
    return res.status(500).json({ error: 'Error interno en login' });
  }
});

// Endpoint para obtener el perfil del usuario actual (Bypassing RLS para evitar recursión)
app.get('/api/profile/me', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('full_name, role')
      .eq('id', req.user.id)
      .maybeSingle();
    
    if (error) throw error;
    res.json(data || {});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Helper para hashear contraseñas para el historial (HMAC con la clave de servicio)
function hashPasswordForHistory(password) {
    return crypto.createHmac('sha256', SUPABASE_SERVICE_ROLE_KEY).update(password).digest('hex');
}

// Endpoint para cambiar contraseña (Usuario autenticado)
app.post('/api/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;
    const userEmail = req.user.email;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'La contraseña actual y la nueva son obligatorias' });
    }

    // 1. VALIDACIÓN DE COMPLEJIDAD
    // 12 caracteres, alfanuméricos (letras y números) y un carácter especial
    const complexityRegex = /^(?=.*[a-zA-Z])(?=.*[0-9])(?=.*[^a-zA-Z0-9]).{12,}$/;
    
    if (!complexityRegex.test(newPassword)) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 12 caracteres, incluir letras, números y un carácter especial.' });
    }

    // 1. Verificar contraseña actual
    const { error: signInError } = await supabaseAdmin.auth.signInWithPassword({
      email: userEmail,
      password: currentPassword
    });

    if (signInError) {
      return res.status(401).json({ error: 'La contraseña actual es incorrecta' });
    }

    // 2. VERIFICAR HISTORIAL (Últimas 3)
    const newHash = hashPasswordForHistory(newPassword);
    
    const { data: history } = await supabaseAdmin
        .from('password_history')
        .select('password_hash')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(3);

    if (history && history.some(h => h.password_hash === newHash)) {
        return res.status(400).json({ error: 'No puedes utilizar ninguna de tus últimas 3 contraseñas.' });
    }

    // 3. Actualizar contraseña en Auth
    const { error } = await supabaseAdmin.auth.admin.updateUserById(
      userId,
      { 
          password: newPassword,
          user_metadata: { 
              ...req.user.user_metadata, // Mantener otros metadatos
              last_password_change: new Date().toISOString() 
          }
      }
    );

    if (error) throw error;

    // 4. Guardar en historial y limpiar antiguos
    await supabaseAdmin.from('password_history').insert({
        user_id: userId,
        password_hash: newHash
    });

    // Mantener solo los últimos 3 registros (limpieza)
    // Subconsulta para borrar los que no estén en el top 3
    // Nota: Supabase/Postgres no soporta limit en delete directamente fácil, lo hacemos simple:
    // No es crítico borrar inmediatamente, pero para mantener la tabla limpia:
    // (Omitido por complejidad SQL inline, el límite de lectura en el paso 2 es suficiente para la lógica)

    // 3. Invalidar todas las sesiones activas (Logout global)
    const { error: signOutError } = await supabaseAdmin.auth.admin.signOut(userId);
    if (signOutError) {
      console.warn('Advertencia: No se pudieron cerrar las sesiones activas:', signOutError.message);
    }

    // 5. Enviar notificación por email
    try {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || '"Gescon360 Security" <no-reply@gescon360.es>',
        to: userEmail,
        subject: '🔐 Seguridad: Contraseña Actualizada',
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
            <h2 style="color: #2c3e50;">Contraseña Actualizada</h2>
            <p>Hola,</p>
            <p>Te informamos que la contraseña de tu cuenta <strong>${userEmail}</strong> ha sido modificada correctamente el ${new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}.</p>
            <p>Si no has realizado este cambio, por favor contacta inmediatamente con el administrador.</p>
            <hr>
            <p style="font-size: 12px; color: #7f8c8d;">Este es un mensaje automático de seguridad de Gescon360.</p>
          </div>
        `
      });
    } catch (mailError) {
      console.error('Error enviando email de cambio de contraseña:', mailError);
    }

    res.json({ success: true, message: 'Contraseña actualizada. Se han cerrado todas las sesiones.' });
  } catch (e) {
    console.error('Error en /api/change-password:', e);
    res.status(500).json({ error: e.message });
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
app.get('/api/config', (req, res) => {
  res.json({
    SUPABASE_URL: SUPABASE_URL,
    SUPABASE_ANON_KEY: SUPABASE_ANON_KEY,
  });
});

app.get('/health/supabase', async (req, res) => {
  try {
    // Consulta mínima: selecciona 1 fila de alguna tabla ligera, por ejemplo "expedientes"
    const { data, error } = await supabaseAdmin
      .from('expedientes')
      .select('id')
      .limit(1);

    if (error) {
      console.error('Error keep-alive Supabase:', error);
      return res.status(500).json({ ok: false, error: error.message });
    }

    return res.json({
      ok: true,
      message: 'Supabase keep-alive ok',
      rows: data?.length ?? 0,
    });
  } catch (err) {
    console.error('Unexpected error keep-alive Supabase:', err);
    return res.status(500).json({ ok: false, error: 'Unexpected error' });
  }
});

app.get('/health', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      database: { status: 'unknown', latency_ms: 0 },
      auth: { status: 'unknown', latency_ms: 0 }
    }
  };

  try {
    // 1. Verificar Base de Datos (Tabla profiles)
    const dbStart = Date.now();
    const { error: dbError } = await supabaseAdmin.from('profiles').select('count', { count: 'exact', head: true });
    health.services.database.latency_ms = Date.now() - dbStart;

    if (dbError) {
      health.services.database.status = 'error';
      health.services.database.error = dbError.message;
      health.status = 'degraded';
    } else {
      health.services.database.status = 'connected';
    }

    // 2. Verificar Servicio de Autenticación
    const authStart = Date.now();
    const { error: authError } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1 });
    health.services.auth.latency_ms = Date.now() - authStart;

    if (authError) {
      health.services.auth.status = 'error';
      health.services.auth.error = authError.message;
      health.status = 'degraded';
    } else {
      health.services.auth.status = 'connected';
    }

    const statusCode = health.status === 'ok' ? 200 : 503;
    res.status(statusCode).json(health);

  } catch (e) {
    console.error('Health check critical failure:', e);
    health.status = 'critical_error';
    health.error = e.message;
    res.status(500).json(health);
  }
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
    // Inicio del mes actual para cálculo de "Nuevos este mes"
    const dateObj = new Date();
    const startOfMonth = new Date(dateObj.getFullYear(), dateObj.getMonth(), 1).toISOString();
    
    // Optimización: Realizar una única consulta para obtener todos los estados y fechas
    // Esto reduce 4 llamadas HTTP a 1, mejorando significativamente la latencia.
    let expedientes = [];
    
    // Intentamos consulta optimizada. Si falla (ej: columna renombrada/faltante), usamos fallback.
    const { data: optimizedData, error: optimizedError } = await supabaseAdmin
      .from('expedientes')
      .select('estado, fecha_seguimiento, gestor_id, created_at, tipo_dano, importe')
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
      nuevosEsteMes: 0,
      urgentesPorUsuario: {},
      porTipoDano: {},
      importeTotalActivo: 0
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

        // Contar nuevos este mes
        if (exp.created_at && exp.created_at >= startOfMonth) {
          stats.nuevosEsteMes++;
        }

        // Desglose por tipo de daño
        const tipo = exp.tipo_dano || 'Sin especificar';
        stats.porTipoDano[tipo] = (stats.porTipoDano[tipo] || 0) + 1;

        // Sumar importe de expedientes activos
        if (!closedStates.has(estado)) {
          stats.importeTotalActivo += (Number(exp.importe) || 0);
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

    // 1. Intentar usar RPC (Cálculo en Base de Datos - Muy Rápido)
    // Requiere crear la función 'get_charts_stats' en Supabase
    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('get_charts_stats');

    let result;

    if (!rpcError && rpcData) {
        result = rpcData;
    } else {
        // 2. Fallback: Cálculo en memoria (si no existe la función RPC)
        // console.warn('RPC get_charts_stats no disponible, usando fallback:', rpcError?.message);

        const { data: expedientes, error } = await supabaseAdmin
          .from('expedientes')
          .select('estado, fecha_ocurrencia, created_at');

        if (error) throw error;

        const statusStats = {};
        const monthlyStats = {};

        (expedientes || []).forEach(exp => {
          const status = exp.estado || 'Sin estado';
          statusStats[status] = (statusStats[status] || 0) + 1;

          const dateStr = exp.fecha_ocurrencia || exp.created_at;
          if (dateStr) {
            const date = new Date(dateStr);
            if (!isNaN(date.getTime())) {
              const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
              monthlyStats[key] = (monthlyStats[key] || 0) + 1;
            }
          }
        });

        result = { status: statusStats, monthly: monthlyStats };
    }

    // Actualizar caché
    apiCache.charts.data = result;
    apiCache.charts.timestamp = now;

    res.json(result);
  } catch (e) {
    console.error('Error en /api/reports/charts:', e);
    res.status(500).json({ error: e.message });
  }
});

/// Endpoint optimizado para estadísticas de CARGA DE TRABAJO (Workload)
app.get('/api/workload/stats', requireAuth, async (req, res) => {
  try {
    // Consultar expedientes activos agrupados por gestor_id
    const { data: expedientes, error } = await supabaseAdmin
      .from('expedientes')
      .select('gestor_id, estado');
    
    if (error) throw error;
    
    // Obtener perfiles para mapear gestor_id a nombres
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, email');
    
    const userMap = new Map();
    if (profiles) {
      profiles.forEach(p => userMap.set(p.id, p.full_name || p.email));
    }
    
    const stats = {};
    const completedStates = new Set(['Completado', 'Archivado', 'Finalizado', 'Finalizado Parcial', 'Rehusado', 'Datos NO válidos']);
    
    (expedientes || []).forEach(exp => {
      if (!exp.gestor_id) return; // Skip sin asignar
      
      const responsable = userMap.get(exp.gestor_id) || 'Desconocido';
      
      if (!stats[responsable]) {
        stats[responsable] = { active: 0, completed: 0 };
      }
      
      if (completedStates.has(exp.estado)) {
        stats[responsable].completed++;
      } else {
        stats[responsable].active++;
      }
    });
    
    res.json(stats);
  } catch (e) {
    console.error('Error en /api/workload/stats:', e);
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
    const { expedientes, opciones, fileName, fileBase64 } = req.body; // Añadido fileBase64
    
    if (!Array.isArray(expedientes)) {
      return res.status(400).json({ error: 'Se requiere un array de expedientes' });
    }
    
    // 1. FASE DE PREPARACIÓN Y VALIDACIÓN (En Memoria)
    const validos = [];
    const erroresValidacion = [];
    const numSiniestrosVistos = new Set();

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

        // Evitar duplicados dentro del mismo archivo de carga
        if (numSiniestrosVistos.has(idExpediente)) {
            throw new Error(`Registro duplicado dentro del archivo: ${idExpediente}`);
        }
        numSiniestrosVistos.add(idExpediente);

        // Clonar y sanear
        const cleanExp = { ...exp };
        cleanExp.num_siniestro = idExpediente;
        delete cleanExp.numero_expediente; // Limpiar campo legacy

        // Validación y saneamiento de tipos de datos
        // 1. Importe: Asegurar que es numérico
        if (cleanExp.importe !== undefined && cleanExp.importe !== null) {
            let impVal = cleanExp.importe;
            if (typeof impVal === 'string') {
                impVal = impVal.replace(/[€$£\s]/g, '').replace(',', '.');
            }
            const imp = parseFloat(impVal);
            cleanExp.importe = isNaN(imp) ? 0 : imp;
        }

        // 2. Fechas: Asegurar formato válido para PostgreSQL
        const dateFields = ['fecha_ocurrencia', 'fecha_inicio', 'fecha_vencimiento', 'fecha_seguimiento'];
        for (const field of dateFields) {
            if (cleanExp[field]) {
                const d = new Date(cleanExp[field]);
                if (isNaN(d.getTime())) {
                    cleanExp[field] = null; // Fecha inválida -> null
                } else {
                    cleanExp[field] = d.toISOString();
                }
            }
        }

        // Valores por defecto
        if (!cleanExp.estado) cleanExp.estado = 'Pdte. revisión';
        
        validos.push(cleanExp);
      } catch (err) {
        erroresValidacion.push({ expediente: exp, error: err.message });
      }
    }

    // 2. FASE DE VERIFICACIÓN DE DUPLICADOS EN DB (Batch)
    let paraInsertar = validos;
    const duplicadosDB = [];

    if (opciones?.verificarDuplicados && validos.length > 0) {
        const ids = validos.map(e => e.num_siniestro);
        
        // Consultar existentes en lote (mucho más rápido que uno a uno)
        // Nota: Si son miles de registros, Supabase podría limitar la URL. 
        // Para producción masiva (>2000), se recomienda chunking, pero para <10MB está bien.
        const { data: existing, error: searchError } = await supabaseAdmin
            .from('expedientes')
            .select('num_siniestro')
            .in('num_siniestro', ids);
            
        if (searchError) throw new Error(`Error verificando duplicados: ${searchError.message}`);
        
        const existingSet = new Set(existing?.map(e => e.num_siniestro));
        
        paraInsertar = [];
        for (const exp of validos) {
            if (existingSet.has(exp.num_siniestro)) {
                duplicadosDB.push(exp);
            } else {
                paraInsertar.push(exp);
            }
        }
    }

    // 3. FASE DE INSERCIÓN TRANSACCIONAL (Bulk Insert)
    // Postgres trata un insert múltiple como una sola transacción atómica.
    // Si falla CUALQUIER registro del lote, falla TODO el lote.
    
    // PREPARACIÓN DE DISTRIBUCIÓN (Antes de insertar para asignar gestor_id)
    let responsables = [];
    if (opciones?.distribuirTareas && opciones?.distribuirEquitativamente) {
        const { data: users } = await supabaseAdmin
            .from('profiles')
            .select('id, full_name, email')
            .eq('status', 'active');
        responsables = users || [];
        
        if (responsables.length > 0) {
            paraInsertar.forEach((exp, index) => {
                const user = responsables[index % responsables.length];
                exp.gestor_id = user.id; // Asignar ID de usuario al expediente
            });
        }
    }

    let exitosos = [];
    
    if (paraInsertar.length > 0) {
        const { data, error } = await supabaseAdmin
          .from('expedientes')
          .insert(paraInsertar)
          .select();
        
        if (error) {
            // Error crítico: Abortar operación completa
            throw new Error(`Error crítico de base de datos (Transacción abortada): ${error.message}`);
        }
        exitosos = data;
    }
    
    // 4. FASE DE DISTRIBUCIÓN DE TAREAS (Opcional)
    let tareasCreadas = 0;
    if (opciones?.distribuirTareas && exitosos.length > 0) {
        // Preparar tareas
        const tareas = exitosos.map((exp) => {
            let responsableNombre = null;
            
            // Recuperar nombre del responsable asignado (si existe gestor_id)
            if (exp.gestor_id && responsables.length > 0) {
                const user = responsables.find(u => u.id === exp.gestor_id);
                if (user) responsableNombre = user.full_name || user.email;
            }

            return {
                num_siniestro: exp.num_siniestro,
                responsable: responsableNombre,
                descripcion: `Gestión inicial del expediente ${exp.num_siniestro} (Importado)`,
                prioridad: (Number(exp.importe) > 1500) ? 'Alta' : 'Media',
                fecha_limite: new Date().toISOString().split('T')[0],
                estado: 'Pdte. revisión'
            };
        });

        // Insertar tareas en lote
        if (tareas.length > 0) {
            const { error: taskError } = await supabaseAdmin.from('tareas').insert(tareas);
            if (!taskError) {
                tareasCreadas = tareas.length;
            }
        }
    }

    // 5. SUBIDA DE ARCHIVO A STORAGE (Nuevo)
    let storagePath = null;
    if (fileBase64 && fileName) {
        try {
            const buffer = Buffer.from(fileBase64, 'base64');
            const cleanName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
            const path = `${Date.now()}_${cleanName}`;
            
            const { error: uploadError } = await supabaseAdmin
                .storage
                .from('imports') // Asegúrate de crear este bucket en Supabase
                .upload(path, buffer, {
                    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    upsert: false
                });
                
            if (!uploadError) storagePath = path;
            else console.warn('Advertencia: Falló la subida a Storage:', uploadError.message);
        } catch (storageErr) {
            console.error('Error procesando subida de archivo:', storageErr);
        }
    }

    // Registrar log de importación en el servidor
    if (fileName) {
      await supabaseAdmin.from('import_logs').insert({
        file_name: fileName,
        total_records: expedientes.length,
        duplicates_count: duplicadosDB.length,
        status: (erroresValidacion.length > 0 || exitosos.length === 0) ? 'Con Advertencias' : 'Completado',
        created_at: new Date().toISOString(),
        storage_path: storagePath, // Guardar referencia (requiere columna en DB)
        error_details: erroresValidacion.length > 0 ? erroresValidacion : null // Guardar JSON de errores
      });
    }
    
    res.json({
        exitosos,
        duplicados: duplicadosDB,
        errores: erroresValidacion,
        tareasCreadas
    });
  } catch (e) {
    console.error('Error en importación:', e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// CRUD COMPLETO DE EXPEDIENTES
// ============================================================================
app.get('/api/expedientes', requireAuth, async (req, res) => {
  try {
    const { gestor_id, estado, buscar, fecha_desde, fecha_hasta, created_at_desde, created_at_hasta, ordenarPor, orden, limite = 100, offset = 0, campos,
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
    
    if (created_at_desde) query = query.gte('created_at', created_at_desde);
    if (created_at_hasta) query = query.lte('created_at', created_at_hasta);

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

app.post('/api/expedientes/:id/archive', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { motivo } = req.body;

    if (!motivo) {
      return res.status(400).json({ error: 'Se requiere un motivo de archivo.' });
    }

    // 1. Obtener los datos del expediente que se va a archivar
    const { data: expediente, error: getError } = await supabaseAdmin
      .from('expedientes')
      .select('*')
      .eq('id', id)
      .single();
    
    if (getError) return res.status(404).json({ error: 'Expediente no encontrado para archivar.' });

    // 2. Insertar el registro en la tabla de archivados
    const { error: archiveError } = await supabaseAdmin
      .from('expedientes_archivados')
      .insert({
        ...expediente,
        estado: 'Archivado', // Estandarizar el estado en la tabla de archivo
        motivo_archivo: motivo,
        fecha_archivo: new Date().toISOString()
      });

    if (archiveError) throw new Error(`Error al mover a archivados: ${archiveError.message}`);

    // 3. Eliminar el registro de la tabla de expedientes activos
    const { error: deleteError } = await supabaseAdmin.from('expedientes').delete().eq('id', id);
    if (deleteError) throw new Error(`Error al eliminar de expedientes activos: ${deleteError.message}`);

    res.json({ success: true, message: `Expediente archivado con motivo: ${motivo}` });
  } catch (e) {
    console.error('Error en /api/expedientes/:id/archive:', e);
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
    
    // CAMBIO: Usar tabla profiles para asegurar consistencia con la asignación de tareas
    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, email, status')
      .eq('status', 'active')
      .order('full_name');
    
    if (profilesError) {
      console.error('Error obteniendo perfiles:', profilesError);
      throw new Error(`Profiles Error: ${profilesError.message}`);
    }
    
    // Mapear solo campos necesarios para dropdowns/selects
    const responsables = profiles.map(p => ({
        id: p.id,
        full_name: p.full_name || p.email,
        email: p.email,
        status: p.status || 'active'
    }));
    
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
    const isSuperAdmin = user.email === SUPER_ADMIN_EMAIL;
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
    const isSuperAdmin = user.email === SUPER_ADMIN_EMAIL;

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

    const { email, fullName, role, status, returnDate } = req.body || {};
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
        status: status || 'active',
        return_date: returnDate || null
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
                        status: status || 'active'
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
        status: status || 'active'
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
    const isSuperAdmin = user.email === SUPER_ADMIN_EMAIL;
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
        status: u.user_metadata?.status || 'active',
        return_date: u.user_metadata?.return_date || null
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
    const isSuperAdmin = user.email === SUPER_ADMIN_EMAIL;
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
    const { fullName, role, status, returnDate } = req.body;

    // Verificar permisos
    const isSuperAdmin = user.email === SUPER_ADMIN_EMAIL;
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
    if (returnDate !== undefined) updates.user_metadata.return_date = returnDate; // Guardar fecha retorno

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

// Endpoint para REACTIVACIÓN AUTOMÁTICA de usuarios
app.post('/admin/users/reactivate', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    // Verificar permisos (admin o sistema)
    const isSuperAdmin = user.email === SUPER_ADMIN_EMAIL;
    if (!isSuperAdmin) {
       const appMeta = user.app_metadata || {};
       if (appMeta.role !== 'admin' && appMeta.is_super_admin !== true) return res.status(403).json({ error: 'No autorizado' });
    }

    // 1. Obtener todos los usuarios
    const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) throw error;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let reactivatedCount = 0;

    // 2. Filtrar y actualizar
    for (const u of users) {
        const meta = u.user_metadata || {};
        if (meta.status !== 'active' && meta.return_date) {
            const returnDate = new Date(meta.return_date);
            // Si la fecha de retorno es hoy o ya pasó
            if (returnDate <= today) {
                // Reactivar usuario
                await supabaseAdmin.auth.admin.updateUserById(u.id, {
                    user_metadata: { ...meta, status: 'active', return_date: null }
                });
                // Sincronizar perfil
                await supabaseAdmin.from('profiles').update({ status: 'active' }).eq('id', u.id);
                reactivatedCount++;
            }
        }
    }
    res.json({ success: true, reactivated: reactivatedCount });
  } catch (e) {
    console.error('Error en reactivación:', e);
    res.status(500).json({ error: e.message });
  }
});

// Endpoint para REDISTRIBUCIÓN AUTOMÁTICA de tareas (Expedientes)
app.post('/admin/redistribute-tasks', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    
    // Solo admins pueden redistribuir
    const isSuperAdmin = user.email === SUPER_ADMIN_EMAIL;
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
        .select('id, num_siniestro, numero_expediente')
        .eq('gestor_id', unavailUser.id)
        .in('estado', ['Pendiente', 'En proceso']);

      if (tasksError || !tasks || tasks.length === 0) continue;

      // Agrupar actualizaciones por usuario destino (Batch Update)
      const updatesByTarget = new Map(); // targetId -> { user, taskIds: [], siniestros: [] }

      tasks.forEach((task, index) => {
          const targetUser = activeUsers[index % activeUsers.length];
          if (!updatesByTarget.has(targetUser.id)) {
              updatesByTarget.set(targetUser.id, { user: targetUser, taskIds: [], siniestros: [] });
          }
          const group = updatesByTarget.get(targetUser.id);
          group.taskIds.push(task.id);
          const num = task.num_siniestro || task.numero_expediente;
          if (num) group.siniestros.push(num);
      });

      // Ejecutar actualizaciones en lote
      for (const [targetId, group] of updatesByTarget) {
        const { error: updateError } = await supabaseAdmin
          .from('expedientes')
          .update({ gestor_id: targetId })
          .in('id', group.taskIds);

        if (!updateError) {
          totalRedistributed += group.taskIds.length;

          if (group.siniestros.length > 0) {
             const targetName = group.user.full_name || group.user.email;
             await supabaseAdmin
               .from('tareas')
               .update({ responsable: targetName })
               .in('num_siniestro', group.siniestros)
               .not('estado', 'in', '("Completada","Archivado","Recobrado")');
          }

          redistribution.push({ count: group.taskIds.length, to: group.user.email });
        }
      }
    }

    // --- NUEVA LÓGICA: Redistribuir Tareas asignadas por nombre (String) ---
    // Esto cubre las tareas creadas manualmente en "Gestión de Tareas"
    const unavailableNames = unavailableUsers.flatMap(u => [u.full_name, u.email]).filter(Boolean);
    
    if (unavailableNames.length > 0) {
        const { data: tasksOnly } = await supabaseAdmin
            .from('tareas')
            .select('id')
            .in('responsable', unavailableNames)
            .not('estado', 'in', '("Completada","Recobrado","Archivado","Rehusado NO cobertura")');

        if (tasksOnly && tasksOnly.length > 0) {
            for (let i = 0; i < tasksOnly.length; i++) {
                const targetUser = activeUsers[i % activeUsers.length];
                const targetName = targetUser.full_name || targetUser.email;
                
                await supabaseAdmin
                    .from('tareas')
                    .update({ responsable: targetName })
                    .eq('id', tasksOnly[i].id);
                
                totalRedistributed++;
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
    const { mode } = req.query;
    const isSimulation = mode === 'simulate';
    const user = req.user;
    
    // Verificar permisos
    const isSuperAdmin = user.email === SUPER_ADMIN_EMAIL;
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

    // 2. Obtener TODAS las TAREAS activas (Fuente de verdad)
    const { data: tasks, error: taskError } = await supabaseAdmin
      .from('tareas')
      .select('id, responsable, num_siniestro, fecha_limite, prioridad')
      .not('estado', 'in', '("Completada","Recobrado","Archivado","Rehusado NO cobertura")');

    if (taskError) throw taskError;

    // 3. Preparar estructuras de datos
    const userMap = new Map(); // Nombre/Email -> ID Usuario
    const workload = {}; // ID Usuario -> { user, tasks: [] }

    // Inicializar workload para usuarios activos
    activeUsers.forEach(u => {
        workload[u.id] = { user: u, tasks: [] };
        if (u.full_name) userMap.set(u.full_name, u.id);
        if (u.email) userMap.set(u.email, u.id);
    });

    // Definir fecha límite para identificar urgentes (Hoy)
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    // 4. Asignar tareas a usuarios
    const unassignedTasks = []; // Tareas de usuarios inactivos o sin asignar

    tasks.forEach(t => {
        if (t.responsable && userMap.has(t.responsable)) {
            const userId = userMap.get(t.responsable);
            workload[userId].tasks.push(t);
        } else {
            // Si el responsable no está en la lista de activos, la tarea es candidata a redistribución
            unassignedTasks.push(t);
        }
    });

    // 5. Calcular Promedio Ideal
    // Incluimos las tareas no asignadas en el total para repartirlas también
    const totalLoad = Object.values(workload).reduce((acc, w) => acc + w.tasks.length, 0) + unassignedTasks.length;
    const averageLoad = Math.floor(totalLoad / activeUsers.length);

    console.log(`Rebalanceo: Total Tareas=${totalLoad}, Usuarios=${activeUsers.length}, Promedio=${averageLoad}`);

    // 6. Recolectar Exceso (Pool de Redistribución)
    let redistributionPool = [...unassignedTasks]; // Empezamos con las huérfanas

    Object.values(workload).forEach(w => {
        if (w.tasks.length > averageLoad) {
            const excessCount = w.tasks.length - averageLoad;
            
            // Ordenar tareas: Mover primero las que NO son urgentes (fecha límite lejana)
            // Las urgentes (hoy/mañana) se quedan con el dueño actual para no interrumpir
            w.tasks.sort((a, b) => {
                const dateA = a.fecha_limite || '9999-99-99';
                const dateB = b.fecha_limite || '9999-99-99';
                // Descendente: Las fechas más lejanas primero (candidatas a mover)
                return dateB.localeCompare(dateA);
            });

            // Tomar el exceso
            const tasksToMove = w.tasks.splice(0, excessCount);
            redistributionPool = redistributionPool.concat(tasksToMove);
        }
    });

    // 7. Repartir el Pool entre usuarios con carga baja
    // Ordenar usuarios por carga actual (ascendente)
    const sortedUsers = Object.values(workload).sort((a, b) => a.tasks.length - b.tasks.length);
    
    let movedCount = 0;
    let userIndex = 0;

    while (redistributionPool.length > 0) {
        const taskToMove = redistributionPool.pop();
        const target = sortedUsers[userIndex];
        
        // Asignar
        const targetName = target.user.full_name || target.user.email;
        
        if (!isSimulation) {
            // A. Actualizar Tarea
            const { error: updateError } = await supabaseAdmin
                .from('tareas')
                .update({ responsable: targetName })
                .eq('id', taskToMove.id);

            if (!updateError) {
                // B. Sincronizar Expediente (si aplica)
                if (taskToMove.num_siniestro) {
                    await supabaseAdmin
                        .from('expedientes')
                        .update({ gestor_id: target.user.id })
                        .eq('num_siniestro', taskToMove.num_siniestro);
                }
            }
        }

        movedCount++;
        target.tasks.push(taskToMove); // Actualizar carga en memoria para el cálculo

        // Avanzar al siguiente usuario (Round Robin) para reparto equitativo
        userIndex = (userIndex + 1) % sortedUsers.length;
    }

    const message = isSimulation
        ? `Simulación: Se moverían ${movedCount} tareas. Carga promedio: ~${averageLoad}.`
        : `Rebalanceo completado. Se movieron ${movedCount} tareas. Carga promedio: ~${averageLoad}.`;

    res.json({ 
        success: true, 
        message: message,
        isSimulation: isSimulation,
        movedCount: movedCount,
        averageLoad: averageLoad
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
    const isSuperAdmin = user.email === SUPER_ADMIN_EMAIL;
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

// Endpoint para CRON: Generar y enviar reporte de carga de trabajo (Excel)
app.post('/api/cron/send-workload-report', async (req, res) => {
  try {
    // Verificar secreto del Cron Job para seguridad
    const authHeader = req.headers['x-cron-secret'];
    if (authHeader !== CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized Cron Request' });
    }

    console.log('Iniciando generación de reporte de carga de trabajo...');

    // 1. Obtener datos (Usuarios y Tareas)
    const { data: users, error: uError } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (uError) throw uError;

    const { data: tasks, error: tError } = await supabaseAdmin
      .from('tareas')
      .select('responsable, estado, prioridad, fecha_limite');
    if (tError) throw tError;

    // 2. Procesar estadísticas
    const activeUsers = [];
    const statsMap = new Map();

    // Filtrar usuarios activos y preparar mapa
    for (const u of users.users) {
      const meta = u.user_metadata || {};
      if (meta.status === 'active') {
        const name = meta.full_name || u.email;
        activeUsers.push({ email: u.email, name });
        
        const statObj = { name, email: u.email, active: 0, completed: 0, highPriority: 0 };
        statsMap.set(name, statObj);
        // Mapear también por email para asegurar coincidencia
        if (name !== u.email) statsMap.set(u.email, statObj);
      }
    }

    // Contar tareas
    (tasks || []).forEach(t => {
      if (t.responsable && statsMap.has(t.responsable)) {
        const stat = statsMap.get(t.responsable);
        const isCompleted = ['Completada', 'Recobrado', 'Rehusado NO cobertura', 'Archivado'].includes(t.estado);
        
        if (isCompleted) {
          stat.completed++;
        } else {
          stat.active++;
          if (t.prioridad === 'Alta') stat.highPriority++;
        }
      }
    });

    // 3. Generar Excel
    // Convertir Map a Array único (eliminando duplicados de referencia email/nombre)
    const reportData = Array.from(new Set(statsMap.values())).map(s => ({
      'Responsable': s.name,
      'Email': s.email,
      'Tareas Activas': s.active,
      'Prioridad Alta': s.highPriority,
      'Completadas': s.completed,
      'Carga Total': s.active + s.completed
    }));

    const worksheet = XLSX.utils.json_to_sheet(reportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Carga de Trabajo");

    // Generar buffer base64 para adjuntar
    const excelBuffer = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });

    // 4. Enviar Emails a cada usuario activo
    const dateStr = new Date().toLocaleDateString('es-ES');
    let sentCount = 0;

    for (const user of activeUsers) {
      const { error: mailError } = await supabaseAdmin.functions.invoke('send-email', {
        body: {
          to: user.email,
          subject: `📊 Reporte Diario de Carga de Trabajo - ${dateStr}`,
          html: `<p>Hola ${user.name},</p><p>Adjunto encontrarás el reporte actualizado de distribución de carga de trabajo del equipo.</p>`,
          attachments: [{
            filename: `Carga_Trabajo_${dateStr.replace(/\//g, '-')}.xlsx`,
            content: excelBuffer,
            encoding: 'base64'
          }]
        }
      });
      if (!mailError) {
        sentCount++;
      } else {
        console.error(`Error enviando reporte a ${user.email}:`, mailError);
      }
    }

    res.json({ success: true, sent: sentCount, total: activeUsers.length });
  } catch (e) {
    console.error('Error en cron reporte carga:', e);
    res.status(500).json({ error: e.message });
  }
});

// Endpoint de utilidad para migrar roles de 'profiles' a 'app_metadata'
app.post('/admin/migrate-roles', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    // Protección extra: solo el super admin principal puede ejecutar esto
    if (user.email !== SUPER_ADMIN_EMAIL) {
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
