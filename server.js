const express = require('express');
const fs = require('fs');
const path = require('path');
const redis = require('redis');

const app = express();
const port = 3000;

const MEDIAPATH = "D:\\Work\\Play Projects\\PixelBluf\\.medias";
const ENDVALUE = 2;         // Upper Value To Limit Folder Search

var CACHEVALUES = {};
var mp4Files = [];

const client = redis.createClient({
  // host: 'YOUR_REDIS_SERVER_HOST',
  // port: YOUR_REDIS_SERVER_PORT,
  // password: 'YOUR_REDIS_SERVER_PASSWORD' 
});


client.on('connect', () => {
  console.log('Connected to Redis server');
});

client.on('error', (err) => {
  console.error('Redis error:', err);
});

async function connectDB() { await client.connect(); }

async function loadDB(id) {
  try {
    const value = await client.json.get(id);
    return value;
  } catch (err) {
    throw new Error(err.message);
  }
}

async function loadDIR() {
  fs.readdir(MEDIAPATH, (err, files) => {
    if (err) {
      throw new Error("Media Directory Failure");
    }
    mp4Files = files.filter(file => { const extName = path.extname(file); return extName === '.mp4' });
  })
};

async function getAllValues() {
  for (let i = 1; i <= ENDVALUE; i++) {
    const key = i.toString().padStart(4, '0');
    try {
      const value = await client.json.get(key, '.');
      if (value !== null) { CACHEVALUES[key + '.mp4'] = value; }
    } catch (err) {
      console.error(`Error getting value for key ${key}:`, err);
    }
  }
};

app.use(express.json());
app.use("/assets/", express.static(path.join(__dirname, 'assets')));
app.use("/icons/", express.static(path.join(__dirname, 'icons')));
app.use("/thumbnails/", express.static(path.join(__dirname, '.thumbnails')));

// Complete
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Complete
app.get('/all', async function (req, res) {
  const order = req.query.order || 'asc';
  if (order === 'asc') { mp4Files.sort((a, b) => a.localeCompare(b)); }
  else { mp4Files.sort((a, b) => b.localeCompare(a)); }
  const result = {};
  mp4Files.forEach(file => { result[file] = CACHEVALUES[file] || null; });
  res.json(result);
});

// Complete
app.get('/video', async (req, res) => {
  const { id } = req.query;
  if (!id) { return res.status(404).json({ error: "Invalid ID" }); }
  const videoPath = path.join(MEDIAPATH, `${id}.mp4`);
  if (!fs.existsSync(videoPath)) { return res.status(404).json({ error: 'File not found' }) };
  const stat = fs.statSync(videoPath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (start >= fileSize) {
      res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
      return;
    }

    const chunkSize = (end - start) + 1;
    const file = fs.createReadStream(videoPath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'video/mp4',
    };

    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(200, head);
    fs.createReadStream(videoPath).pipe(res);
  }
});

// Complete
app.get('/info', async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) { throw new Error(); }
    const db = await loadDB(id);
    if (db) {
      const formattedData = {
        Title: db.Title, Time: db.Time, Artist: db.Artist,
        Category: db.Category
      };
      res.json(formattedData);
    }
    else { res.status(404).end("No Data Available"); }
  } catch (err) {
    res.status(404).json({ error: "Invalid ID" });
  }
});

// Complete
app.post('/info', async (req, res) => {
  try {
    const { title, time, artist, category } = req.body;
    const { id } = req.query;
    if (!id) throw new Error();
    const data = {
      Title: title,
      Time: time,
      Artist: artist,
      Category: category
    };
    await client.json.set(id, '.', data, { NX: false });
    res.json({ message: 'Data set successfully', data });
    getAllValues();
  } catch (err) {
    res.status(500).json({ error: 'Error Occured While Posting Info' });
  }
});

app.all('/*', (req, res) => {
  res.status(404).send('404 Not Found');
});

async function runStartupTasks() {
  try {
    new Promise((resolve) => { /*connectDB();*/ resolve(); }).then(() => { return new Promise((resolve) => { loadDIR(); resolve(); }); }).then(() => { return new Promise((resolve) => { getAllValues(); resolve(); }); }) .then(() => { console.log('All startup tasks completed'); })
  }
  catch (err) {
    console.error('Error during startup tasks:', err);
    process.exit(1);
  }
}
runStartupTasks().then(() => { 
  app.listen(port, () => { 
    console.log(`Server is running on http://localhost:${port}`); 
}); });