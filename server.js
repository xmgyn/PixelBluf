require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const redis = require('redis');

const app = express();
const port = 3000;

var END;
var CACHEVALUES = {};
var mp4Files = [];

const client = redis.createClient({
    username: process.env.REDIS_USERNAME,
    password: process.env.REDIS_PASSWORD,
    socket: {
        host: process.env.REDIS_HOST,
        port: 17663
    }
});

client.on('connect', () => {
  console.log('Connected to Redis server');
});

client.on('error', (err) => {
  console.error('Redis error : ', err);
});

function timeToMinutes(time) {
  const parts = time.split(':').reverse();
  let minutes = 0;

  if (parts[0]) { 
      minutes += parseInt(parts[1]) || 0; 
  }
  if (parts[2]) {
      minutes += parseInt(parts[2]) * 60; 
  }
  return minutes;
}

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
  fs.readdir(process.env.MEDIAPATH, (err, files) => {
    if (err) {
      throw new Error("Media Directory Failure");
    }

    // Only Accept MP4 Files As Video.js Works Best With MP4 H.264 Videos
    mp4Files = files.filter(file => { const extName = path.extname(file); const baseName = path.basename(file, extName); return extName === '.mp4' && /^[0-9]{4}$/.test(baseName); });
  
    // Add FFMpeg H.264 Check If Needed,  Else Convert Them Manually
  })
};

// Server Caching
async function getAllValues() {
  END = await client.get('ENDVALUE');
  END = parseInt(END, 10);
  for (let i = 1; i <= END; i++) {
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
app.use("/assets/", express.static(path.join(__dirname, 'Assets')));
app.use("/icons/", express.static(path.join(__dirname, 'Assets/Icons')));
app.use("/thumbnails/", express.static(path.join(__dirname, 'Medias/Thumbnails')));

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
  const idPattern = /^\d{4}$/;
  if (!id || !idPattern.test(id)) { return res.status(404).json({ error: "Invalid ID" }); }
  const videoPath = path.join(process.env.MEDIAPATH, `${id}.mp4`);
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
    const idPattern = /^\d{4}$/;
    if (!id || !idPattern.test(id)) { throw new Error(); }
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
    const idPattern = /^\d{4}$/;
    if (!id || !idPattern.test(id)) throw new Error();
    const data = {
      Title: title,
      Time: timeToMinutes(time),
      Artist: artist,
      Category: category
    };
    await client.json.set(id, '.', data, { NX: false });
    if (id > END) console.log("Increment END");
    const getall = await getAllValues();
    res.status(200).json({ message: 'Data set successfully', data });
  } catch (err) {
    res.status(500).json({ error: 'Error Occured While Posting Info' });
  }
});

app.all('/*', (req, res) => {
  res.status(404).send('404 Not Found');
});

async function runStartupTasks() {
  try {
    new Promise((resolve) => { connectDB(); resolve(); }).then(() => { return new Promise((resolve) => { loadDIR(); resolve(); }); }).then(() => { return new Promise((resolve) => { getAllValues(); resolve(); }); }) .then(() => { console.log('All startup tasks completed'); })
  }
  catch (err) {
    console.error('Error during startup tasks:', err);
    process.exit(1);
  }
}
runStartupTasks().then(() => { 
  app.listen(port, () => { 
    console.log(`Server is running on ${port}`); 
}); });
