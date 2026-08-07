const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Permitir archivos JSON amplios para respaldos grandes

const DIR_DATOS = path.join(__dirname, 'datos_locales');

// Asegurar que exista la carpeta principal de almacenamiento
if (!fs.existsSync(DIR_DATOS)) {
  fs.mkdirSync(DIR_DATOS, { recursive: true });
}

// Función auxiliar para obtener o crear la carpeta de un local
const getLocalFolder = (localId) => {
  const idLimpio = (localId || 'default').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const dir = path.join(DIR_DATOS, idLimpio);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};

// Leer datos en formato JSON de forma segura
const obtenerDatos = (archivoPath, porDefecto) => {
  if (!fs.existsSync(archivoPath)) return porDefecto;
  const data = fs.readFileSync(archivoPath, 'utf-8');
  return data ? JSON.parse(data) : porDefecto;
};

// Guardar datos en formato JSON
const guardarDatos = (archivoPath, datos) => {
  fs.writeFileSync(archivoPath, JSON.stringify(datos, null, 2));
};

// ================= API PEDIDOS =================

// Obtener pedidos de un local específico
app.get('/api/pedidos', (req, res) => {
  const local = req.query.local || 'default';
  const folder = getLocalFolder(local);
  res.json(obtenerDatos(path.join(folder, 'pedidos.json'), []));
});

// Guardar un nuevo pedido
app.post('/api/pedidos', (req, res) => {
  const { local, mesa, items, total } = req.body;
  if (!mesa || !items || items.length === 0) {
    return res.status(400).json({ error: 'Faltan datos obligatorios para el pedido.' });
  }

  const folder = getLocalFolder(local);
  const archivoPedidos = path.join(folder, 'pedidos.json');
  const pedidos = obtenerDatos(archivoPedidos, []);

  const nuevoPedido = {
    id: Date.now(),
    mesa,
    items,
    total,
    estado: 'Pendiente',
    hora: new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
  };

  pedidos.push(nuevoPedido);
  guardarDatos(archivoPedidos, pedidos);
  res.status(201).json({ mensaje: 'Pedido recibido con éxito', pedido: nuevoPedido });
});

// Actualizar o eliminar un pedido existente
app.patch('/api/pedidos/:id', (req, res) => {
  const { id } = req.params;
  const { local, estado } = req.body;
  const folder = getLocalFolder(local);
  const archivoPedidos = path.join(folder, 'pedidos.json');
  let pedidos = obtenerDatos(archivoPedidos, []);
  
  const index = pedidos.findIndex(p => p.id == id);
  if (index !== -1) {
    if (estado === 'Eliminar') {
      pedidos.splice(index, 1);
    } else {
      pedidos[index].estado = estado;
    }
    guardarDatos(archivoPedidos, pedidos);
    return res.json({ mensaje: 'Estado del pedido actualizado.' });
  }
  res.status(404).json({ error: 'Pedido no encontrado.' });
});

// ================= API MENÚ Y CONFIGURACIÓN =================

// Cargar el menú de un local
app.get('/api/menu', (req, res) => {
  const local = req.query.local || 'default';
  const folder = getLocalFolder(local);
  const menuPorDefecto = [{ categoria: "Completos", productos: [{ id: "1", nombre: "Completo Italiano", precio: 2990 }] }];
  res.json(obtenerDatos(path.join(folder, 'menu.json'), menuPorDefecto));
});

// Guardar el menú de un local comprobando la contraseña propia del local
app.post('/api/menu', (req, res) => {
  const { local, password, menu } = req.body;
  const folder = getLocalFolder(local);
  
  const configPath = path.join(folder, 'config.json');
  const config = obtenerDatos(configPath, { password: 'admin' });

  if (password !== config.password) {
    return res.status(401).json({ error: 'Contraseña de administración incorrecta.' });
  }

  guardarDatos(path.join(folder, 'menu.json'), menu);
  res.json({ mensaje: 'Menú guardado con éxito.' });
});

// ================= SUPER ADMIN: GESTIÓN DE LOCALES, RESPALDOS Y RESTAURACIÓN =================

// Crear nuevo local con clave asignada
app.post('/api/superadmin/crear-local', (req, res) => {
  const { claveSuperAdmin, local, passwordCliente } = req.body;
  if (claveSuperAdmin !== 'superadmin123') {
    return res.status(401).json({ error: 'Acceso no autorizado. Clave Super Admin incorrecta.' });
  }

  if (!local || !passwordCliente) {
    return res.status(400).json({ error: 'Debe ingresar el identificador del local y su contraseña.' });
  }

  const folder = getLocalFolder(local);
  guardarDatos(path.join(folder, 'config.json'), { password: passwordCliente });

  res.json({ mensaje: `Local "${local}" creado exitosamente con su clave personalizada.` });
});

// Descargar respaldo completo del servidor
app.get('/api/superadmin/backup', (req, res) => {
  const { clave } = req.query;
  if (clave !== 'superadmin123') {
    return res.status(401).json({ error: 'Acceso no autorizado. Clave Super Admin incorrecta.' });
  }

  const backupData = {};
  if (fs.existsSync(DIR_DATOS)) {
    const carpetasLocales = fs.readdirSync(DIR_DATOS);
    carpetasLocales.forEach(localId => {
      const folderPath = path.join(DIR_DATOS, localId);
      if (fs.statSync(folderPath).isDirectory()) {
        backupData[localId] = {
          config: obtenerDatos(path.join(folderPath, 'config.json'), { password: 'admin' }),
          menu: obtenerDatos(path.join(folderPath, 'menu.json'), []),
          pedidos: obtenerDatos(path.join(folderPath, 'pedidos.json'), [])
        };
      }
    });
  }
  res.json(backupData);
});

// Restaurar todo el servidor desde un archivo subido
app.post('/api/superadmin/restore', (req, res) => {
  const { clave, backupData } = req.body;
  if (clave !== 'superadmin123') {
    return res.status(401).json({ error: 'Acceso no autorizado. Clave Super Admin incorrecta.' });
  }

  try {
    Object.keys(backupData).forEach(localId => {
      const folder = getLocalFolder(localId);
      if (backupData[localId].config) {
        guardarDatos(path.join(folder, 'config.json'), backupData[localId].config);
      }
      if (backupData[localId].menu) {
        guardarDatos(path.join(folder, 'menu.json'), backupData[localId].menu);
      }
      if (backupData[localId].pedidos) {
        guardarDatos(path.join(folder, 'pedidos.json'), backupData[localId].pedidos);
      }
    });
    res.json({ mensaje: '¡Servidor restaurado exitosamente!' });
  } catch (error) {
    res.status(500).json({ error: 'Error al procesar la restauración del archivo.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor activo en el puerto ${PORT}`));