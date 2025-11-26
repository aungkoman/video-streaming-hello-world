const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

// --- FIX FOR WINDOWS FFMPEG PATH ---
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
ffmpeg.setFfmpegPath(ffmpegPath);
// -----------------------------------

const app = express();
app.use(cors());

// 1. Setup Storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = './uploads';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

// 2. Serve static files
app.use('/videos', express.static(path.join(__dirname, 'public/videos')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- ADD THIS BLOCK ---
app.get('/watch', (req, res) => {
    res.sendFile(path.join(__dirname, 'watch.html'));
});

// --- HELPER: Transcode Function ---
// This returns a Promise so we can run them sequentially or in parallel
const transcodeVideo = (inputPath, outputDir, resolution, bitrate, filename) => {
  return new Promise((resolve, reject) => {
    console.log(`Starting ${resolution} transcoding...`);
    
    ffmpeg(inputPath)
      .outputOptions([
        '-hls_time 10',
        '-hls_list_size 0',
        '-f hls'
      ])
      .videoCodec('libx264')
      .audioCodec('aac')
      .size(resolution)
      .videoBitrate(bitrate)
      .on('end', () => {
        console.log(`${resolution} finished.`);
        resolve();
      })
      .on('error', (err) => {
        console.error(`${resolution} error:`, err);
        reject(err);
      })
      .save(`${outputDir}/${filename}.m3u8`);
  });
};


// 3. Upload and Transcode Route
app.post('/upload', upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded.');
  }

  const inputPath = req.file.path;
  const outputDir = `./public/videos/${req.file.filename.split('.')[0]}`;
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  try {
    // A. Run Transcoding Jobs (360p, 720p, 1080p)
    // We await them so we know they are done before making the master file
    const p1 = transcodeVideo(inputPath, outputDir, '640x360', '800k', '360p');
    const p2 = transcodeVideo(inputPath, outputDir, '1280x720', '2500k', '720p');
    const p3 = transcodeVideo(inputPath, outputDir, '1920x1080', '5000k', '1080p');

    // Wait for ALL to finish
    await Promise.all([p1, p2, p3]);

    // B. Create the Master Playlist (master.m3u8) manually
    // This file links the 3 versions together
    const masterPlaylistContent = `
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
360p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720
720p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
1080p.m3u8
    `.trim();

    fs.writeFileSync(`${outputDir}/master.m3u8`, masterPlaylistContent);

    console.log('All Transcoding finished!');
    
    const streamUrl = `http://localhost:3000/videos/${req.file.filename.split('.')[0]}/master.m3u8`;
    res.json({ message: 'Video processed', streamUrl: streamUrl });

  } catch (error) {
    console.error(error);
    res.status(500).send('Transcoding failed');
  }
});

app.listen(3000, () => {
  console.log('Server started on http://localhost:3000');
});