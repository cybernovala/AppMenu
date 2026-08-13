const express = require('express');
const cors = require('cors');
const path = require('path');
const { MongoClient } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://appmenu:appmenu123@cluster0.mongodb.net/appmenu?retryWrites=true&w=majority";
let db;

async function conectarDB() {
  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db('appmenu_db');
    console.log("✅ Conectado a MongoDB");
  } catch (err) {
    console.error("⚠️ Error MongoDB:", err.message);
  }
}
conectarDB();

// API MENU
app.get('/api/menu', async (req, res) => {
  try {
    const local = (req.query.local || '1').toLowerCase().trim();
    if (!db) return res.status(500).json({ error: "DB no conectada" });

    const localDoc = await db.collection('locales').findOne({ local });
    if (localDoc && localDoc.activo === false) {
      return res.status(403).json({ error: "Local bloqueado por administración" });
    }

    const items = await db.collection('menu').find({ local }).toArray();
    
    if (req.query.modo === 'estructurado') {
      const categoriasMap = {};
      items.forEach(i => {
        const cat = i.categoria || 'Sin Categoría';
        if (!categoriasMap[cat]) categoriasMap[cat] = [];
        categoriasMap[cat].push({ nombre: i.nombre, precio: i.precio });
      });
      const resultado = Object.keys(categoriasMap).map(cat => ({
        categoria: cat,
        productos: categoriasMap[cat]
      }));
      return res.json(resultado);
    }

    res.json(items);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/menu', async (req, res) => {
  try {
    const { local, categoria, nombre, precio } = req.body;
    await db.collection('menu').insertOne({
      local: local.toLowerCase().trim(),
      categoria,
      nombre,
      precio: Number(precio)
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// LICENCIA & LOCALES
app.get('/api/licencia', async (req, res) => {
  try {
    const local = (req.query.local || '1').toLowerCase().trim();
    if (!db) return res.json({ activo: true });

    let localDoc = await db.collection('locales').findOne({ local });
    if (!localDoc) {
      const hoy = new Date();
      const venc = new Date(hoy.setDate(hoy.getDate() + 30));
      localDoc = {
        local,
        nombre: local.toUpperCase(),
        activo: true,
        altaRegistrada: false,
        fechaVencimiento: venc.toISOString()
      };
      await db.collection('locales').insertOne(localDoc);
    }

    if (localDoc.activo === false) {
      return res.status(403).json({ activo: false, error: "Local desactivado" });
    }

    res.json(localDoc);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/locales/alta', async (req, res) => {
  try {
    const { nombre, rut, correo, password } = req.body;
    const localSlug = nombre.toLowerCase().replace(/[^a-z0-9]/g, '');
    const hoy = new Date();
    const venc = new Date(hoy.setDate(hoy.getDate() + 30));

    await db.collection('locales').updateOne(
      { local: localSlug },
      {
        $set: {
          local: localSlug,
          nombre,
          rut,
          correo,
          password,
          altaRegistrada: true,
          activo: true,
          fechaVencimiento: venc.toISOString()
        }
      },
      { upsert: true }
    );

    res.json({ success: true, local: localSlug });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// SUPERADMIN ENDPOINTS
app.get('/api/superadmin/locales', async (req, res) => {
  try {
    if (!db) return res.json([]);
    const list = await db.collection('locales').find().toArray();
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/superadmin/locales/estado', async (req, res) => {
  try {
    const { local, activo } = req.body;
    await db.collection('locales').updateOne(
      { local: local.toLowerCase().trim() },
      { $set: { activo: Boolean(activo) } }
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/superadmin/locales/renovar', async (req, res) => {
  try {
    const { local, dias } = req.body;
    const localClean = local.toLowerCase().trim();

    const doc = await db.collection('locales').findOne({ local: localClean });
    let baseFecha = new Date();
    if (doc && doc.fechaVencimiento) {
      const fActual = new Date(doc.fechaVencimiento);
      if (fActual > baseFecha) baseFecha = fActual;
    }

    const nuevaFecha = new Date(baseFecha.setDate(baseFecha.getDate() + (dias || 30)));

    await db.collection('locales').updateOne(
      { local: localClean },
      { $set: { fechaVencimiento: nuevaFecha.toISOString(), activo: true } }
    );

    res.json({ success: true, nuevaFecha: nuevaFecha.toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor listo en puerto ${PORT}`);
});
