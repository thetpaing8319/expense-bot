require('dotenv').config();

const { Telegraf } = require('telegraf');
const ytdlp = require('youtube-dl-exec');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const token = process.env.BOT_TOKEN?.trim();

if (!token) {
  console.error('BOT_TOKEN မရှိပါ။ Railway Variables မှာ ထည့်ပါ။');
  process.exit(1);
}

const bot = new Telegraf(token, {
  handlerTimeout: 300000
});

const MAX_BYTES = 45 * 1024 * 1024;
const MAX_SECONDS = 900;
let busy = false;

const commonFlags = {
  ignoreConfig: true,
  noPlaylist: true,
  noProgress: true,
  jsRuntimes: 'node',
  remoteComponents: 'ejs:github',
  socketTimeout: 20,
  retries: 1,
  extractorRetries: 1
};

function errorText(error) {
  return [
    error?.stderr,
    error?.message,
    error?.description,
    typeof error === 'string' ? error : ''
  ]
    .filter(Boolean)
    .join('\n')
    .split(token).join('[TOKEN HIDDEN]')
    .slice(-5000);
}

function explainError(error) {
  const text = errorText(error);

  if (/sign in to confirm|not a bot|captcha|HTTP Error 429/i.test(text)) {
    return '❌ YouTube က ဒီဆာဗာရဲ့ request ကို ကန့်သတ်ထားပါတယ်။ ' +
      'ခဏနားပြီး ပြန်စမ်းပါ။ ဆက်ဖြစ်နေရင် hosting/network ပြောင်းစမ်းဖို့ လိုနိုင်ပါတယ်။';
  }

  if (/ffmpeg|ffprobe/i.test(text)) {
    return '❌ FFmpeg ပြဿနာဖြစ်နေပါတယ်။ Railway က Dockerfile နဲ့ build လုပ်ထားသလား စစ်ပါ။';
  }

  if (/private video|unavailable|not available|age.restrict|sign in/i.test(text)) {
    return '❌ ဒီ video ကို download မရပါ။ အများပြည်သူကြည့်လို့ရတဲ့ အခြား YouTube link နဲ့ စမ်းပါ။';
  }

  if (/timed out|timeout|ETIMEDOUT|SIGKILL/i.test(text)) {
    return '❌ အချိန်ကြာလွန်းလို့ ရပ်လိုက်ပါတယ်။ ပိုတိုတဲ့သီချင်းနဲ့ ပြန်စမ်းပါ။';
  }

  if (/requested format|403|challenge|javascript runtime/i.test(text)) {
    return '❌ YouTube audio ထုတ်ယူမရပါ။ အခြားသီချင်းနဲ့ စမ်းပါ။ ' +
      'ဆက်ဖြစ်ရင် yt-dlp update နဲ့ Railway logs စစ်ဖို့လိုပါတယ်။';
  }

  return '❌ မအောင်မြင်ပါ။ Railway → Deploy Logs မှာ [Music Error] ကို ကြည့်ပါ။';
}

async function reply(ctx, text) {
  try {
    return await ctx.reply(text);
  } catch (error) {
    console.error('[Reply Error]', errorText(error));
    return null;
  }
}

async function status(ctx, messageId, text) {
  try {
    await ctx.telegram.editMessageText(
      ctx.chat.id, messageId, undefined, text
    );
  } catch {
    // A status edit failure should not cancel the download.
  }
}

function searchTarget(query) {
  if (/^https?:\/\//i.test(query)) {
    const url = new URL(query);
    const host = url.hostname.toLowerCase();

    if (
      host !== 'youtu.be' &&
      host !== 'youtube.com' &&
      !host.endsWith('.youtube.com')
    ) {
      throw new Error('YOUTUBE_LINK_ONLY');
    }

    if (url.username || url.password) {
      throw new Error('YOUTUBE_LINK_ONLY');
    }

    return url.href;
  }

  return `ytsearch1:${query}`;
}

bot.start(ctx => reply(
  ctx,
  '🎵 Music Bot အသင့်ဖြစ်ပါပြီ။\n\n' +
  '/play သီချင်းနာမည်\n' +
  'ဥပမာ: /play perfect ed sheeran\n\n' +
  'YouTube link နဲ့လည်း ရပါတယ်။\n' +
  '၁၅ မိနစ်အောက် သီချင်းတွေကို ပို့ပေးပါမယ်။'
));

bot.command('ping', ctx => reply(ctx, '✅ Bot အလုပ်လုပ်နေပါတယ်။'));

bot.command('play', async ctx => {
  const query = ctx.message.text
    .replace(/^\/play(?:@\w+)?(?:\s+|$)/i, '')
    .trim();

  if (!query) {
    return reply(ctx, 'ဥပမာ: /play perfect ed sheeran');
  }

  if (query.length > 500) {
    return reply(ctx, 'သီချင်းနာမည် သို့မဟုတ် link ကို ပိုတိုအောင် ထည့်ပါ။');
  }

  let target;

  try {
    target = searchTarget(query);
  } catch {
    return reply(ctx, 'YouTube link သို့မဟုတ် သီချင်းနာမည် ထည့်ပါ။');
  }

  if (busy) {
    return reply(ctx, '⏳ သီချင်းတစ်ပုဒ် လုပ်ပေးနေပါတယ်။ ပြီးမှ ပြန်စမ်းပါ။');
  }

  busy = true;
  let tempDir;
  let message;

  try {
    message = await reply(ctx, '🔎 သီချင်းရှာနေပါတယ်…');
    if (!message) return;

    const result = await ytdlp(target, {
      ...commonFlags,
      dumpSingleJson: true,
      skipDownload: true
    }, {
      timeout: 60000,
      killSignal: 'SIGKILL'
    });

    const video = Array.isArray(result.entries)
      ? result.entries.find(Boolean)
      : result;

    if (!video?.id) {
      await status(ctx, message.message_id, '❌ သီချင်းရှာမတွေ့ပါ။');
      return;
    }

    if (video.is_live || video.live_status === 'is_upcoming') {
      await status(ctx, message.message_id, '❌ Live video ကို မပို့ပေးနိုင်ပါ။');
      return;
    }

    const duration = Number(video.duration);

    if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_SECONDS) {
      await status(
        ctx, message.message_id,
        '❌ ကြာချိန်သိနိုင်တဲ့ ၁၅ မိနစ်အောက် video နဲ့ စမ်းပါ။'
      );
      return;
    }

    if (!/^[A-Za-z0-9_-]{11}$/.test(video.id)) {
      throw new Error('Invalid YouTube video ID');
    }

    const title = String(video.title || query).slice(0, 200);
    const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;

    await status(
      ctx, message.message_id,
      `📥 ${title}\nMP3 ပြင်ဆင်နေပါတယ်…`
    );

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'music-bot-'));
    const output = path.join(tempDir, 'audio.%(ext)s');

    await ytdlp.exec(videoUrl, {
      ...commonFlags,
      format: 'bestaudio/best',
      extractAudio: true,
      audioFormat: 'mp3',
      audioQuality: '128K',
      maxFilesize: '45M',
      matchFilter: '!is_live & duration <= 900',
      fragmentRetries: 1,
      output
    }, {
      timeout: 150000,
      killSignal: 'SIGKILL'
    });

    const audioPath = path.join(tempDir, 'audio.mp3');
    const file = await fs.stat(audioPath).catch(() => null);

    if (!file || file.size === 0) {
      throw new Error('Audio file missing: download skipped or failed');
    }

    if (file.size > MAX_BYTES) {
      await status(
        ctx, message.message_id,
        '❌ ဖိုင်ကြီးလွန်းပါတယ်။ ပိုတိုတဲ့သီချင်းနဲ့ စမ်းပါ။'
      );
      return;
    }

    await status(ctx, message.message_id, '📤 Telegram သို့ ပို့နေပါတယ်…');

    await ctx.replyWithAudio({
      source: audioPath,
      filename: 'audio.mp3'
    }, {
      title,
      performer: String(video.artist || video.uploader || 'Unknown').slice(0, 100),
      duration: Math.round(duration),
      caption: videoUrl
    });

    await status(ctx, message.message_id, '✅ ပို့ပြီးပါပြီ။');

  } catch (error) {
    console.error('[Music Error]', errorText(error));

    if (message) {
      await status(ctx, message.message_id, explainError(error));
    } else {
      await reply(ctx, explainError(error));
    }
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true })
        .catch(() => {});
    }
    busy = false;
  }
});

bot.catch(error => {
  console.error('[Bot Error]', errorText(error));
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    try {
      bot.stop(signal);
    } catch {
      process.exit(0);
    }
  });
}

async function main() {
  const me = await bot.telegram.getMe();
  console.log(`[Starting] @${me.username}`);
  await bot.launch();
}

main().catch(error => {
  console.error('[Launch Error]', errorText(error));
  process.exit(1);
});
