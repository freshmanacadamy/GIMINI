const TelegramBot = require('node-telegram-bot-api');
const nodemailer = require('nodemailer');
const fetch = require('node-fetch');

// Environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASS = process.env.GMAIL_PASS;

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN is required');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: false });
const userPhotos = new Map();

// Gmail transporter
let transporter;
if (GMAIL_USER && GMAIL_PASS) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_PASS
    }
  });
} else {
  console.log('⚠️ Gmail credentials not set - Gmail upload disabled');
}

// Handle start command
const handleStart = async (msg) => {
  const chatId = msg.chat.id;
  
  await bot.sendMessage(chatId,
    `📸 Photo Upload Bot\n\n` +
    `Send me a photo and I'll give you the file link!` +
    (transporter ? `\n📧 I can also upload it to Gmail!` : '')
  );
};

// Handle photos
const handlePhoto = async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const photo = msg.photo[msg.photo.length - 1];
  
  try {
    // Get file info
    const file = await bot.getFile(photo.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
    
    // Store photo info
    if (!userPhotos.has(userId)) {
      userPhotos.set(userId, []);
    }
    
    userPhotos.get(userId).push({
      url: fileUrl,
      time: new Date()
    });
    
    // Create keyboard
    const keyboard = {
      reply_markup: {
        inline_keyboard: []
      }
    };
    
    if (transporter) {
      keyboard.reply_markup.inline_keyboard.push([
        { text: '📧 Upload to Gmail', callback_data: `gmail_${photo.file_id}` }
      ]);
    }
    
    keyboard.reply_markup.inline_keyboard.push([
      { text: '❌ Close', callback_data: 'cancel' }
    ]);
    
    // Send file URL to user (NO MARKDOWN)
    await bot.sendMessage(chatId,
      `✅ Photo Received!\n\n` +
      `🔗 File URL:\n${fileUrl}\n\n` +
      `📊 Size: ${(file.file_size / 1024).toFixed(1)} KB`,
      { 
        reply_markup: keyboard.reply_markup
      }
    );
    
  } catch (error) {
    console.error('Photo handling error:', error);
    await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
  }
};

// Upload to Gmail
const uploadToGmail = async (fileUrl, fileName, chatId) => {
  try {
    // Download image
    const response = await fetch(fileUrl);
    
    if (!response.ok) {
        throw new Error(`Failed to download file: ${response.statusText}`);
    }
    
    const buffer = await response.buffer();
    
    const mailOptions = {
      from: GMAIL_USER,
      to: GMAIL_USER,
      subject: `Telegram Photo - ${fileName}`,
      text: `Photo uploaded from Telegram Bot\nFile: ${fileName}\nTime: ${new Date().toLocaleString()}`,
      attachments: [
        {
          filename: fileName,
          content: buffer
        }
      ]
    };
    
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error('Gmail error:', error);
    return false;
  }
};

// Handle callback queries
const handleCallbackQuery = async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  
  try {
    if (data.startsWith('gmail_')) {
      const fileId = data.replace('gmail_', '');
      
      await bot.answerCallbackQuery(callbackQuery.id, { text: '📧 Uploading to Gmail...' });
      
      const file = await bot.getFile(fileId);
      const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
      const fileExt = file.file_path.split('.').pop() || 'jpg';
      const fileName = `photo_${Date.now()}.${fileExt}`;
      
      const success = await uploadToGmail(fileUrl, fileName, chatId);
      
      if (success) {
        await bot.sendMessage(chatId,
          `✅ Uploaded to Gmail!\n\n` +
          `📧 Sent to: ${GMAIL_USER}\n` +
          `📎 File: ${fileName}`
        );
      } else {
        await bot.sendMessage(chatId, '❌ Failed to upload to Gmail');
      }
    } else if (data === 'cancel') {
      await bot.answerCallbackQuery(callbackQuery.id, { text: 'Closed' });
      await bot.deleteMessage(chatId, callbackQuery.message.message_id);
    }
  } catch (error) {
    console.error('Callback query error:', error);
    await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Error occurred during action.' });
  }
};

// Handle messages
const handleMessage = async (msg) => {
  const text = msg.text;
  
  if (text === '/start') {
    await handleStart(msg);
  } else {
    // If user sends any other text, show start menu
    await handleStart(msg);
  }
};

// Vercel handler
module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method === 'GET') {
    return res.json({ 
      status: 'Bot is running!',
      users_tracked: userPhotos.size,
      gmail_enabled: !!transporter
    });
  }
  
  if (req.method === 'POST') {
    try {
      const update = req.body;
      
      if (update.message) {
        if (update.message.photo) {
          await handlePhoto(update.message);
        } else if (update.message.text) {
          await handleMessage(update.message);
        }
      } else if (update.callback_query) {
        await handleCallbackQuery(update.callback_query);
      }
      
      return res.json({ ok: true });
    } catch (error) {
      console.error('Webhook processing error:', error);
      return res.status(200).json({ error: error.message, acknowledged: true });
    }
  }
  
  return res.status(405).json({ error: 'Method not allowed' });
};
