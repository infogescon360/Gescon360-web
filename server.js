// server.js - Backend seguro para gestión de roles de administrador y tareas
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
// Si tu Node es < 18, descomenta esto y añade node-fetch como dependencia:
// import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';

const app = express();

app.use(express.json());
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

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // clave pública / anon para consultas

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_KEY) {
  console.error('ERROR: Faltan variables de entorno requeridas');
  process.exit(1);
}

<<<<<<< HEAD
// Cliente normal para datos (expedientes, tareas, etc.)
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
=======
// ---------------------------------------------------------------------
// Supabase client (para expedientes/tareas)
// ---------------------------------------------------------------------
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  db: { schema: 'public' }
});
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: 'public' }
});
>>>>>>> 505dd19ca9ee000ef8144a721776fc0956f23b4d

// Cliente de servicio SOLO para auth/administración
const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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

  return await response.json();
}

async function isUserAdmin(userId) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error('No se pudo verificar el usuario');
  }

  const userData = await response.json();
  return userData.is_super_admin === true;
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

// ============================================================================
// AUTENTICACIÓN BÁSICA: LOGIN CON EMAIL + PASSWORD
// Devuelve: access_token, email, role (desde tabla profiles) y esAdmin bool
// ============================================================================

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña son obligatorios' });
    }

    // 1) Login contra Supabase Auth usando service role
    const { data: signInData, error: signInError } =
      await supabaseAuth.auth.signInWithPassword({ email, password });

    if (signInError || !signInData.session) {
      console.error('Error en signInWithPassword:', signInError);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const { session, user } = signInData;
    const accessToken = session.access_token;
    const userId = user.id;

    // 2) Obtener rol desde tabla profiles
    const { data: profile, error: profileError } = await supabaseAuth
      .from('profiles')
      .select('role, status')
      .eq('id', userId)
      .maybeSingle();

    if (profileError) {
      console.error('Error obteniendo perfil:', profileError);
    }

    const role = profile?.role || 'user';
    const status = profile?.status || 'active';

    if (status !== 'active') {
      return res.status(403).json({ error: 'Usuario inactivo o bloqueado' });
    }

    // 3) Comprobar si es super admin (opcional, para panel avanzado)
    let esSuperAdmin = false;
    try {
      const adminInfo = await isUserAdmin(userId);
      esSuperAdmin = adminInfo === true;
    } catch (e) {
      esSuperAdmin = false;
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
      return res
        .status(401)
        .json({ error: 'No se proporcionó token de autorización' });
    }

    const accessToken = authHeader.substring(7);
    const { targetUserId, makeAdmin } = req.body;

    if (!targetUserId || typeof makeAdmin !== 'boolean') {
      return res.status(400).json({
        error:
          'Parámetros inválidos. Se requiere targetUserId (string) y makeAdmin (boolean)',
      });
    }

    const callerUser = await getUserFromToken(accessToken);
    console.log(
      `Solicitud de ${callerUser.email} para cambiar rol de usuario ${targetUserId}`
    );

    const callerIsAdmin = await isUserAdmin(callerUser.id);
    if (!callerIsAdmin) {
      console.warn(
        `Usuario ${callerUser.email} intentó cambiar roles sin ser administrador`
      );
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
      `✓ Usuario ${callerUser.email} ${
        makeAdmin ? 'promovió' : 'revocó'
      } permisos admin de usuario ${targetUserId}`
    );

    res.json({
      success: true,
      message: makeAdmin
        ? 'Usuario promovido a administrador'
        : 'Permisos de administrador revocados',
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
// Endpoints de tareas / expedientes
// ---------------------------------------------------------------------

app.get('/api/tareas', async (req, res) => {
  try {
    const { gestorId, estado, vencenHoy } = req.query;
    let query = supabase.from('expedientes').select('*');

    if (gestorId) query = query.eq('gestor_id', gestorId);
    if (estado) query = query.eq('estado', estado);
    if (vencenHoy === 'true') {
      const hoy = new Date();
      const iso = hoy.toISOString().slice(0, 10); // YYYY-MM-DD
      query = query.eq('fecha_seguimiento', iso);
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/tareas/:id', async (req, res) => {
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
      const { data: expData, error: getErr } = await supabase
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

      const { error: insErr } = await supabase
        .from('expedientes_archivados')
        .insert(archivado);

      if (insErr) return res.status(500).json({ error: insErr.message });

      await supabase.from('expedientes').delete().eq('id', id);

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
// Endpoints adicionales para búsqueda, duplicados, archivados y reportes
// ---------------------------------------------------------------------

// Búsqueda avanzada de expedientes
app.get('/api/expedientes/buscar', async (req, res) => {
  try {
    const { expediente, poliza, sgr, dni } = req.query;

    let query = supabase.from('expedientes').select('*');

    if (expediente) query = query.ilike('numero_expediente', `%${expediente}%`);
    if (poliza) query = query.ilike('numero_poliza', `%${poliza}%`);
    if (sgr) query = query.ilike('numero_sgr', `%${sgr}%`);
    if (dni) query = query.ilike('dni', `%${dni}%`);

    const { data, error } = await query.limit(100);

    if (error) return res.status(500).json({ error: error.message });

    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Verificar duplicados
app.post('/api/duplicados/verificar', async (req, res) => {
  try {
    const { expedientes } = req.body;

    if (!Array.isArray(expedientes)) {
      return res.status(400).json({ error: 'Se requiere un array de expedientes' });
    }

    const duplicados = [];

    for (const exp of expedientes) {
      const { data, error } = await supabase
        .from('expedientes')
        .select('*')
        .or(
          `numero_expediente.eq.${exp.numero_expediente},numero_poliza.eq.${exp.numero_poliza},dni.eq.${exp.dni}`
        );

      if (error) continue;

      if (data && data.length > 0) {
        duplicados.push({
          nuevo: exp,
          existente: data[0],
          motivo: 'Coincide expediente, póliza o DNI',
        });
      }
    }

    res.json({ duplicados, total: duplicados.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Obtener expedientes archivados
app.get('/api/archivados', async (req, res) => {
  try {
    const { motivo, desde, hasta, limite = 50 } = req.query;

    let query = supabase.from('expedientes_archivados').select('*');

    if (motivo) query = query.eq('motivo_archivo', motivo);
    if (desde) query = query.gte('created_at', desde);
    if (hasta) query = query.lte('created_at', hasta);

    query = query.order('created_at', { ascending: false }).limit(parseInt(limite));

    const { data, error } = await query;

    if (error) return res.status(500).json({ error: error.message });

    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Restaurar expediente archivado
app.post('/api/archivados/:id/restaurar', async (req, res) => {
  try {
    const { id } = req.params;

    // Obtener el expediente archivado
    const { data: archivado, error: getErr } = await supabase
      .from('expedientes_archivados')
      .select('*')
      .eq('id', id)
      .single();

    if (getErr) return res.status(500).json({ error: getErr.message });

    // Insertar en expedientes activos
    const { error: insErr } = await supabase
      .from('expedientes')
      .insert({
        ...archivado,
        estado: 'En proceso',
      });

    if (insErr) return res.status(500).json({ error: insErr.message });

    // Eliminar de archivados
    await supabase.from('expedientes_archivados').delete().eq('id', id);

    res.json({ ok: true, message: 'Expediente restaurado correctamente' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Generar reporte de estadísticas
app.get('/api/reportes/estadisticas', async (req, res) => {
  try {
    // Expedientes totales
    let queryTotal = supabase
      .from('expedientes')
      .select('*', { count: 'exact', head: true });

    const { count: total } = await queryTotal;

    // Por estado
    const estados = ['Pendiente', 'En proceso', 'Finalizado', 'Archivado'];
    const porEstado = {};

    for (const estado of estados) {
      const { count } = await supabase
        .from('expedientes')
        .select('*', { count: 'exact', head: true })
        .eq('estado', estado);

      porEstado[estado] = count || 0;
    }

    // Archivados
    const { count: archivados } = await supabase
      .from('expedientes_archivados')
      .select('*', { count: 'exact', head: true });

    res.json({
      total,
      porEstado,
      archivados,
      fecha_generacion: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Importar expedientes en lote
app.post('/api/expedientes/importar', async (req, res) => {
  try {
    const { expedientes, opciones } = req.body;

    if (!Array.isArray(expedientes)) {
      return res.status(400).json({ error: 'Se requiere un array de expedientes' });
    }

    const resultados = {
      exitosos: [],
      duplicados: [],
      errores: [],
    };

    for (const exp of expedientes) {
      try {
        // Verificar duplicados si está habilitado
        if (opciones?.verificarDuplicados) {
          const { data: existe } = await supabase
            .from('expedientes')
            .select('id')
            .eq('numero_expediente', exp.numero_expediente)
            .single();

          if (existe) {
            resultados.duplicados.push(exp);
            continue;
          }
        }

        // Insertar expediente
        const { data, error } = await supabase
          .from('expedientes')
          .insert(exp)
          .select()
          .single();

        if (error) throw error;

        resultados.exitosos.push(data);
      } catch (err) {
        resultados.errores.push({
          expediente: exp,
          error: err.message,
        });
      }
    }

    res.json(resultados);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// ADMIN: CREACIÓN DE USUARIOS DESDE EL PANEL DE SEGURIDAD
// ============================================================================

app.post('/admin/users', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '').trim();

    if (!token) {
      return res.status(401).json({ error: 'Token de autenticación no proporcionado' });
    }

    // Verificar sesión y rol admin igual que en /admin/check
    const {
      data: { user },
      error: authError,
    } = supabase.auth.getUser
      ? await supabase.auth.getUser(token)
      : { data: { user: null }, error: { message: 'Método getUser no disponible' } };

    if (authError || !user) {
      return res.status(401).json({ error: 'Sesión no válida' });
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError || !profile || profile.role !== 'admin') {
      return res.status(403).json({ error: 'Solo administradores pueden crear usuarios' });
    }

    const { email, fullName, role } = req.body || {};

    if (!email || !role) {
      return res.status(400).json({ error: 'Email y rol son obligatorios' });
    }

    if (!email.endsWith('@gescon360.es')) {
      return res
        .status(400)
        .json({ error: 'El email debe pertenecer al dominio @gescon360.es' });
    }

    if (!['admin', 'user'].includes(role)) {
      return res.status(400).json({ error: 'Rol no válido. Debe ser "admin" o "user"' });
    }

    const tempPassword = generateStrongPassword();

<<<<<<< HEAD
    const { data: createdUser, error: createError } =
      await supabaseAuth.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
      });
=======
    // Crear usuario en Auth usando SERVICE_ROLE_KEY (supabaseAdmin)
    const { data: createdUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true
    });
// ============================================================================
// CRUD COMPLETO DE EXPEDIENTES
// ============================================================================

// GET /api/expedientes - Listar todos los expedientes (con filtros opcionales)
app.get('/api/expedientes', async (req, res) => {
  try {
    const { gestor_id, estado, buscar, limite = 100, offset = 0 } = req.query;
    
    let query = supabase.from('expedientes').select('*', { count: 'exact' });
    
    // Filtros opcionales
    if (gestor_id) query = query.eq('gestor_id', gestor_id);
    if (estado) query = query.eq('estado', estado);
    if (buscar) {
      query = query.or(
        `numero_expediente.ilike.%${buscar}%,` +
        `numero_poliza.ilike.%${buscar}%,` +
        `numero_sgr.ilike.%${buscar}%,` +
        `dni.ilike.%${buscar}%,` +
        `cliente_nombre.ilike.%${buscar}%`
      );
    }
    
    query = query
      .order('created_at', { ascending: false })
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

// GET /api/expedientes/:id - Obtener un expediente por ID
app.get('/api/expedientes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data, error } = await supabase
      .from('expedientes')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) {
      return res.status(404).json({ error: 'Expediente no encontrado' });
    }
    
    res.json(data);
  } catch (e) {
    console.error('Error en GET /api/expedientes/:id:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/expedientes - Crear un nuevo expediente
app.post('/api/expedientes', async (req, res) => {
  try {
    const expediente = req.body;
    
    // Validaciones básicas
    if (!expediente.numero_expediente) {
      return res.status(400).json({ error: 'El número de expediente es obligatorio' });
    }
    
    // Verificar duplicados
    const { data: existe, error: checkError } = await supabase
      .from('expedientes')
      .select('id')
      .eq('numero_expediente', expediente.numero_expediente)
      .maybeSingle();
    
    if (existe) {
      return res.status(409).json({ 
        error: 'Ya existe un expediente con ese número',
        expediente_existente_id: existe.id
      });
    }
    
    // Insertar expediente
    const { data, error } = await supabase
      .from('expedientes')
      .insert({
        ...expediente,
        estado: expediente.estado || 'Pendiente',
        created_at: new Date().toISOString()
      })
      .select()
      .single();
    // ============================================================================
// CRUD COMPLETO DE EXPEDIENTES
// ============================================================================

// GET /api/expedientes - Listar todos los expedientes (con filtros opcionales)
app.get('/api/expedientes', async (req, res) => {
  try {
    const { gestor_id, estado, buscar, limite = 100, offset = 0 } = req.query;
    
    let query = supabase.from('expedientes').select('*', { count: 'exact' });
    
    // Filtros opcionales
    if (gestor_id) query = query.eq('gestor_id', gestor_id);
    if (estado) query = query.eq('estado', estado);
    if (buscar) {
      query = query.or(
        `numero_expediente.ilike.%${buscar}%,` +
        `numero_poliza.ilike.%${buscar}%,` +
        `numero_sgr.ilike.%${buscar}%,` +
        `dni.ilike.%${buscar}%,` +
        `cliente_nombre.ilike.%${buscar}%`
      );
    }
    
    query = query
      .order('created_at', { ascending: false })
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

// GET /api/expedientes/:id - Obtener un expediente por ID
app.get('/api/expedientes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data, error } = await supabase
      .from('expedientes')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) {
      return res.status(404).json({ error: 'Expediente no encontrado' });
    }
    
    res.json(data);
  } catch (e) {
    console.error('Error en GET /api/expedientes/:id:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/expedientes - Crear un nuevo expediente
app.post('/api/expedientes', async (req, res) => {
  try {
    const expediente = req.body;
    
    // Validaciones básicas
    if (!expediente.numero_expediente) {
      return res.status(400).json({ error: 'El número de expediente es obligatorio' });
    }
    
    // Verificar duplicados
    const { data: existe, error: checkError } = await supabase
      .from('expedientes')
      .select('id')
      .eq('numero_expediente', expediente.numero_expediente)
      .maybeSingle();
    
    if (existe) {
      return res.status(409).json({ 
        error: 'Ya existe un expediente con ese número',
        expediente_existente_id: existe.id
      });
    }
    
    // Insertar expediente
    const { data, error } = await supabase
      .from('expedientes')
      .insert({
        ...expediente,
        estado: expediente.estado || 'Pendiente',
        created_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (error) {
      console.error('Error insertando expediente:', error);
      return res.status(500).json({ error: error.message });
    }
    
    res.status(201).json(data);
  } catch (e) {
    console.error('Error en POST /api/expedientes:', e);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/expedientes/:id - Actualizar un expediente completo
app.put('/api/expedientes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const cambios = req.body;
    
    // Actualizar expediente
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

// DELETE /api/expedientes/:id - Eliminar un expediente
app.delete('/api/expedientes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Primero obtener el expediente para archivarlo
    const { data: expediente, error: getError } = await supabase
      .from('expedientes')
      .select('*')
      .eq('id', id)
      .single();
    
    if (getError) {
      return res.status(404).json({ error: 'Expediente no encontrado' });
    }
    
    // Archivar el expediente antes de eliminarlo
    const { error: archiveError } = await supabase
      .from('expedientes_archivados')
      .insert({
        ...expediente,
        motivo_archivo: 'Eliminado manualmente',
        fecha_archivo: new Date().toISOString()
      });
    
    if (archiveError) {
      console.warn('No se pudo archivar el expediente antes de eliminarlo:', archiveError);
      // Continuamos con la eliminación de todos modos
    }
    
    // Eliminar el expediente
    const { error: deleteError } = await supabase
      .from('expedientes')
      .delete()
      .eq('id', id);
    
    if (deleteError) {
      return res.status(500).json({ error: deleteError.message });
    }
    
    res.json({ 
      ok: true, 
      message: 'Expediente eliminado correctamente',
      archivado: !archiveError
    });
  } catch (e) {
    console.error('Error en DELETE /api/expedientes/:id:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/expedientes/:id/seguimientos - Obtener seguimientos de un expediente
app.get('/api/expedientes/:id/seguimientos', async (req, res) => {
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

// POST /api/expedientes/:id/seguimientos - Añadir seguimiento a un expediente
app.post('/api/expedientes/:id/seguimientos', async (req, res) => {
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
// FIN CRUD EXPEDIENTES
// ============================================================================

    if (error) {
      console.error('Error insertando expediente:', error);
      return res.status(500).json({ error: error.message });
    }
    
    res.status(201).json(data);
  } catch (e) {
    console.error('Error en POST /api/expedientes:', e);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/expedientes/:id - Actualizar un expediente completo
app.put('/api/expedientes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const cambios = req.body;
    
    // Actualizar expediente
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

// DELETE /api/expedientes/:id - Eliminar un expediente
app.delete('/api/expedientes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Primero obtener el expediente para archivarlo
    const { data: expediente, error: getError } = await supabase
      .from('expedientes')
      .select('*')
      .eq('id', id)
      .single();
    
    if (getError) {
      return res.status(404).json({ error: 'Expediente no encontrado' });
    }
    
    // Archivar el expediente antes de eliminarlo
    const { error: archiveError } = await supabase
      .from('expedientes_archivados')
      .insert({
        ...expediente,
        motivo_archivo: 'Eliminado manualmente',
        fecha_archivo: new Date().toISOString()
      });
    
    if (archiveError) {
      console.warn('No se pudo archivar el expediente antes de eliminarlo:', archiveError);
      // Continuamos con la eliminación de todos modos
    }
    
    // Eliminar el expediente
    const { error: deleteError } = await supabase
      .from('expedientes')
      .delete()
      .eq('id', id);
    
    if (deleteError) {
      return res.status(500).json({ error: deleteError.message });
    }
    
    res.json({ 
      ok: true, 
      message: 'Expediente eliminado correctamente',
      archivado: !archiveError
    });
  } catch (e) {
    console.error('Error en DELETE /api/expedientes/:id:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/expedientes/:id/seguimientos - Obtener seguimientos de un expediente
app.get('/api/expedientes/:id/seguimientos', async (req, res) => {
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

// POST /api/expedientes/:id/seguimientos - Añadir seguimiento a un expediente
app.post('/api/expedientes/:id/seguimientos', async (req, res) => {
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
    console.log(' GET /api/expedientes');
console.log(' GET /api/expedientes/:id');
console.log(' POST /api/expedientes');
console.log(' PUT /api/expedientes/:id');
console.log(' DELETE /api/expedientes/:id');
console.log(' GET /api/expedientes/:id/seguimientos');
console.log(' POST /api/expedientes/:id/seguimientos');

    if (error) return res.status(500).json({ error: error.message });
    
    res.status(201).json(data);
  } catch (e) {
    console.error('Error en POST /api/expedientes/:id/seguimientos:', e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// FIN CRUD EXPEDIENTES
// ============================================================================
>>>>>>> 505dd19ca9ee000ef8144a721776fc0956f23b4d

    if (createError) {
      console.error('Error creando usuario en Auth:', createError);
      return res
        .status(500)
        .json({ error: 'No se pudo crear el usuario en Supabase Auth' });
    }

    const userId = createdUser.user?.id;

    const { error: profileUpsertError } = await supabaseAuth
      .from('profiles')
      .upsert({
        id: userId,
        email,
        full_name: fullName || email.split('@')[0],
        role,
        status: 'active',
      });

    if (profileUpsertError) {
      console.error('Error actualizando perfil:', profileUpsertError);
    }

    return res.json({
      message: 'Usuario creado correctamente',
      email,
      role,
      tempPassword,
    });
  } catch (e) {
    console.error('Error en /admin/users:', e);
    return res.status(500).json({ error: 'Error interno del servidor' });
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
<<<<<<< HEAD
// Arranque del servidor
// ---------------------------------------------------------------------

const PORT = process.env.PORT || 3000;

=======
// CRUD Clientes, Pólizas y Siniestros
// ---------------------------------------------------------------------

// CRUD Clientes
app.get('/api/clientes', async (req, res) => {
  try {
    const { buscar, limite = 50 } = req.query;
    let query = supabase.from('clientes').select('*');
    if (buscar) query = query.or(`nombre.ilike.%${buscar}%,apellidos.ilike.%${buscar}%,dni.ilike.%${buscar}%,email.ilike.%${buscar}%`);
    query = query.order('created_at', { ascending: false }).limit(parseInt(limite));
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

// CRUD Pólizas
app.get('/api/polizas', async (req, res) => {
  try {
    const { cliente_id, buscar, limite = 50 } = req.query;
    let query = supabase.from('polizas').select('*');
    if (cliente_id) query = query.eq('cliente_id', cliente_id);
    if (buscar) query = query.or(`numero_poliza.ilike.%${buscar}%,compania.ilike.%${buscar}%`);
    query = query.order('created_at', { ascending: false }).limit(parseInt(limite));
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

// CRUD Siniestros
app.get('/api/siniestros', async (req, res) => {
  try {
    const { poliza_id, buscar, limite = 50 } = req.query;
    let query = supabase.from('siniestros').select('*');
    if (poliza_id) query = query.eq('poliza_id', poliza_id);
    if (buscar) query = query.or(`numero_siniestro.ilike.%${buscar}%,descripcion.ilike.%${buscar}%`);
    query = query.order('created_at', { ascending: false }).limit(parseInt(limite));
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
>>>>>>> 505dd19ca9ee000ef8144a721776fc0956f23b4d
app.listen(PORT, () => {
  console.log(`🚀 Servidor ejecutándose en puerto ${PORT}`);
  console.log('📍 Endpoints:');
  console.log(' POST /api/login');
  console.log(' POST /admin/set-admin');
  console.log(' GET /admin/check');
  console.log(' GET /config');
  console.log(' GET /api/tareas');
  console.log(' PATCH /api/tareas/:id');
  console.log(' GET /health');
  console.log(' GET /api/expedientes/buscar');
  console.log(' POST /api/duplicados/verificar');
  console.log(' GET /api/archivados');
  console.log(' POST /api/archivados/:id/restaurar');
  console.log(' GET /api/reportes/estadisticas');
  console.log(' POST /api/expedientes/importar');
  console.log(' POST /admin/users');
});
<<<<<<< HEAD
=======




>>>>>>> 505dd19ca9ee000ef8144a721776fc0956f23b4d
