const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// SCHEMA DE MONGOOSE
const localSchema = new mongoose.Schema({
  localId: { type: String, required: true, unique: true },
  nombre: { type: String, required: true },
  rut: { type: String, default: '' },
  correo: { type: String, default: '' },
  password: { type: String, default: '' },
  activo: { type: Boolean, default: true },
  altaRegistrada: { type: Boolean, default: false },
  fechaCreacion: { type: Date, default: Date.now },
  fechaVencimiento: { type: Date }
});

const Local = mongoose.model('Local', localSchema);

// RUTAS API

// Obtener todos los locales (SuperAdmin)
app.get('/api/locales', async (req, res) => {
  try {
    const locales = await Local.find().sort({ fechaCreacion: -1 });
    res.json(locales);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener la lista de restaurantes' });
  }
});

// Obtener un local específico por slug/ID (Admin)
app.get('/api/locales/:localId', async (req, res) => {
  try {
    const local = await Local.findOne({ localId: req.params.localId.toLowerCase() });
    if (!local) {
      return res.status(404).json({ error: 'Restaurante no encontrado' });
    }
    res.json(local);
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar datos del local' });
  }
});

// Crear local demo (Sin registro completo)
app.post('/api/locales', async (req, res) => {
  try {
    const { nombre } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });

    const localId = nombre.toLowerCase().trim().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');

    let localExistente = await Local.findOne({ localId });
    if (localExistente) {
      return res.status(400).json({ error: 'Ya existe un local con este nombre' });
    }

    const nuevoLocal = new Local({
      localId,
      nombre,
      activo: true,
      altaRegistrada: false
    });

    await nuevoLocal.save();
    res.status(201).json(nuevoLocal);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear local demo' });
  }
});

// Dar de alta un restaurante cliente oficial
app.post('/api/locales/alta', async (req, res) => {
  try {
    const { nombre, rut, correo, password } = req.body;

    if (!nombre || !rut || !correo || !password) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }

    const localId = nombre.toLowerCase().trim().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');

    let localExistente = await Local.findOne({ localId });
    if (localExistente) {
      return res.status(400).json({ error: 'Ya existe un local registrado con ese nombre' });
    }

    const nuevoLocal = new Local({
      localId,
      nombre,
      rut,
      correo,
      password,
      activo: true,
      altaRegistrada: true,
      fechaCreacion: new Date()
    });

    await nuevoLocal.save();

    res.status(201).json({
      mensaje: 'Local dado de alta exitosamente',
      local: nuevoLocal
    });
  } catch (error) {
    console.error('Error al dar de alta:', error);
    res.status(500).json({ error: 'Error interno del servidor al procesar el alta' });
  }
});

// Cambiar estado de la licencia (Bloquear / Desbloquear)
app.patch('/api/locales/:localId/licencia', async (req, res) => {
  try {
    const { activo } = req.body;
    const local = await Local.findOneAndUpdate(
      { localId: req.params.localId },
      { activo },
      { new: true }
    );
    if (!local) return res.status(404).json({ error: 'Local no encontrado' });
    res.json(local);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar el estado de la licencia' });
  }
});

// INICIAR SERVIDOR
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/appmenu';

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('✅ Conectado a MongoDB Atlas');
    app.listen(PORT, () => console.log(`🚀 Servidor ejecutándose en el puerto ${PORT}`));
  })
  .catch(err => console.error('❌ Error de conexión a MongoDB:', err));
