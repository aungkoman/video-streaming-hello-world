const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

// --- FIX FOR WINDOWS FFMPEG PATH ---
// This tells the script to use the ffmpeg binary installed by npm
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
ffmpeg.setFfmpegPath(ffmpegPath);
// -----------------------------------

const app = express();
app.use(cors());

// 1. Setup Storage for raw uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = './uploads';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    // Unique filename to prevent overwrites
    cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

// 2. Serve static files (The "CDN" and the Frontend)
app.use('/videos', express.static(path.join(__dirname, 'public/videos')));

// --- NEW ROUTE: Serve index.html on root ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});
// -------------------------------------------

// 3. Upload and Transcode Route
app.post('/upload', upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded.');
  }

  const inputPath = req.file.path;
  // Create a clean folder name based on filename
  const outputDir = `./public/videos/${req.file.filename.split('.')[0]}`;
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = `${outputDir}/master.m3u8`;

  console.log('Starting transcoding...');

  // 4. FFmpeg Command
  ffmpeg(inputPath)
    .outputOptions([
      '-hls_time 10',     
      '-hls_list_size 0', 
      '-f hls'            
    ])
    .videoCodec('libx264')
    .audioCodec('aac')
    .size('1280x720')
    .on('end', () => {
      console.log('Transcoding finished!');
      const streamUrl = `http://localhost:3000/videos/${req.file.filename.split('.')[0]}/master.m3u8`;
      res.json({ message: 'Video processed', streamUrl: streamUrl });
    })
    .on('error', (err) => {
      console.error('Error:', err);
      res.status(500).send('Transcoding failed');
    })
    .save(outputPath);
});

app.listen(3000, () => {
  console.log('Server started on http://localhost:3000');
});