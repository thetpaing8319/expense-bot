require('dotenv').config();

const { Telegraf } = require('telegraf');
const ytSearch = require('yt-search');
const axios = require('axios');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

// ───── Settings ─────

if (!process.env.BOT_TOKEN) {
    throw new Error('BOT_TOKEN မရှိပါ!');
}

const bot = new Telegraf(process.env.BOT_TOKEN, {
    handlerTimeout: 240000
});

// ဆာဗာများ လက်ရှိ အလုပ်လုပ်နေကြောင်း အာမမခံနိုင်ပါ။
const PIPED_INSTANCES = (
    process.env.PIPED_INSTANCES ||
    [
        'https://pipedapi.kavin.rocks',
        'https://pipedapi.tokhmi.xyz',
        'https://api.piped.projectsegfau.lt'
    ].join(',')
)
    .split(',')
    .map(url => url.trim().replace(/\/+$/, ''))
    .filter(Boolean);

const MAX_FILE_BYTES = 45 * 1024 * 1024;
const activeUsers = new Set();

// ───── Helpers ─────

function errorReason(error) {
    let reason;

    if (typeof error === 'string') {
        reason = error;
    } else {
        reason =
            error?.message ||
            error?.description ||
            error?.cause?.message ||
            'Unknown error';
    }

    if (error?.response?.status) {
        reason = `HTTP ${error.response.status}: ${reason}`;
    }

    if (error?.code) {
        reason = `${error.code}: ${reason}`;
    }

    // Log ထဲ Bot Token မပါအောင် ဖျောက်ထားသည်။
    const token = process.env.BOT_TOKEN;
    if (token) {
        reason = String(reason).split(token).join('[TOKEN HIDDEN]');
    }

    return String(reason).slice(0, 1500);
}

async function safeReply(ctx, text) {
    try {
        await ctx.reply(text);
    } catch {
        console.error('[Telegram] Reply မပို့နိုင်ပါ');
    }
}

async function updateStatus(ctx, messageId, text) {
    try {
        await ctx.telegram.editMessageText(
            ctx.chat.id,
            messageId,
            undefined,
            text
        );
    } catch {
        console.warn('[Telegram] Status မပြောင်းနိုင်ပါ');
    }
}

// API တစ်ခုက link ရပြီး download မရရင်
// နောက် API တစ်ခုကို ဆက်စမ်းပါမယ်။
async function downloadFromPiped(videoId, filePath) {
    const failures = [];

    for (const instance of PIPED_INSTANCES) {
        try {
            const { data } = await axios.get(
                `${instance}/streams/${encodeURIComponent(videoId)}`,
                {
                    timeout: 12000,
                    headers: {
                        Accept: 'application/json'
                    }
                }
            );

            if (
                !Array.isArray(data?.audioStreams) ||
                data.audioStreams.length === 0
            ) {
                throw new Error(
                    'Response ထဲမှာ audioStreams မပါပါ'
                );
            }

            const candidates = data.audioStreams
                .filter(stream =>
                    typeof stream?.url === 'string' &&
                    /^https?:\/\//i.test(stream.url) &&
                    (
                        String(stream.mimeType || '')
                            .toLowerCase()
                            .includes('audio/mp4') ||
                        String(stream.format || '')
                            .toUpperCase() === 'M4A'
                    )
                )
                .sort((a, b) =>
                    (Number(a.bitrate) || 0) -
                    (Number(b.bitrate) || 0)
                );

            if (candidates.length === 0) {
                const formats = data.audioStreams
                    .map(stream =>
                        stream?.mimeType ||
                        stream?.format ||
                        'unknown'
                    )
                    .join(', ');

                throw new Error(
                    `M4A မရပါ။ Formats: ${formats}`
                );
            }

            // File size သက်သာစေရန် bitrate နည်းတာကိုရွေးသည်။
            const selected = candidates[0];

            // Download တစ်ကြိမ်ကို အများဆုံး ၄၅ စက္ကန့်။
            const controller = new AbortController();
            const timer = setTimeout(
                () => controller.abort(),
                45000
            );

            try {
                const response = await axios.get(selected.url, {
                    responseType: 'stream',
                    timeout: 20000,
                    signal: controller.signal
                });

                const contentType = String(
                    response.headers['content-type'] || ''
                ).toLowerCase();

                if (
                    contentType.includes('text/') ||
                    contentType.includes('json')
                ) {
                    response.data.destroy();
                    throw new Error(
                        'Audio အစား HTML/Text response ရနေပါသည်'
                    );
                }

                const declaredSize = Number(
                    response.headers['content-length'] || 0
                );

                if (declaredSize > MAX_FILE_BYTES) {
                    response.data.destroy();
                    throw new Error(
                        'ဖိုင်အရွယ်အစား 45 MB ထက်ကြီးနေပါသည်'
                    );
                }

                let downloadedBytes = 0;

                const sizeLimiter = new Transform({
                    transform(chunk, encoding, callback) {
                        downloadedBytes += chunk.length;

                        if (downloadedBytes > MAX_FILE_BYTES) {
                            return callback(
                                new Error(
                                    'ဖိုင်အရွယ်အစား 45 MB ကျော်သွားပါသည်'
                                )
                            );
                        }

                        callback(null, chunk);
                    }
                });

                await pipeline(
                    response.data,
                    sizeLimiter,
                    fs.createWriteStream(filePath),
                    { signal: controller.signal }
                );

                if (downloadedBytes === 0) {
                    throw new Error('ရရှိသည့်ဖိုင်မှာ ဗလာဖြစ်နေပါသည်');
                }
            } finally {
                clearTimeout(timer);
            }

            console.log(`[Piped OK] ${instance}`);
            return;

        } catch (error) {
            const reason = errorReason(error);

            console.error(
                `[Piped Failed] ${instance} — ${reason}`
            );

            failures.push(`${instance}: ${reason}`);

            // Download တစ်ဝက်တစ်ပျက်ဖိုင် ရှိရင် ဖျက်ပါ။
            await fsp.rm(filePath, { force: true }).catch(() => {});
        }
    }

    const error = new Error(
        'ဆာဗာအားလုံးမှ Audio မရပါ။\n' +
        failures.join('\n')
    );

    error.code = 'AUDIO_UNAVAILABLE';
    throw error;
}

// ───── Commands ─────

bot.start(ctx =>
    ctx.reply(
        '🎵 Music Bot မှ ကြိုဆိုပါတယ်။\n\n' +
        'သီချင်းရှာရန်:\n' +
        '/play သီချင်းနာမည်\n\n' +
        'ဥပမာ: /play perfect'
    )
);

bot.command('play', async ctx => {
    const query = (ctx.message?.text || '')
        .replace(/^\/play(?:@\w+)?(?:\s+|$)/i, '')
        .trim();

    if (!query) {
        await safeReply(
            ctx,
            'သီချင်းနာမည် ထည့်ပေးပါ။\nဥပမာ: /play perfect'
        );
        return;
    }

    const userId = ctx.from.id;

    if (activeUsers.has(userId)) {
        await safeReply(
            ctx,
            '⏳ အရင်သီချင်းကို လုပ်ဆောင်နေပါတယ်။ ခဏစောင့်ပေးပါ။'
        );
        return;
    }

    activeUsers.add(userId);

    let waitMsg;
    let tempDir;

    try {
        waitMsg = await ctx.reply(
            '🔍 သီချင်းရှာနေပါတယ်...'
        );

        const result = await ytSearch(query);
        const video = result.videos?.[0];

        if (!video) {
            await updateStatus(
                ctx,
                waitMsg.message_id,
                '❌ သီချင်းရှာမတွေ့ပါ။ နာမည်ပြောင်းပြီး စမ်းကြည့်ပါ။'
            );
            return;
        }

        await updateStatus(
            ctx,
            waitMsg.message_id,
            `🎧 ${video.title}\n\n` +
            '📥 Audio ရယူနေပါတယ်။ ခဏစောင့်ပေးပါ။'
        );

        tempDir = await fsp.mkdtemp(
            path.join(os.tmpdir(), 'music-bot-')
        );

        const filePath = path.join(tempDir, 'audio.m4a');

        await downloadFromPiped(video.videoId, filePath);

        await updateStatus(
            ctx,
            waitMsg.message_id,
            '📤 Telegram သို့ ပို့နေပါတယ်...'
        );

        await ctx.replyWithAudio(
            {
                source: filePath,
                filename: 'audio.m4a'
            },
            {
                title: video.title,
                performer: video.author?.name || 'Unknown',
                caption: `🎵 ${video.title}`.slice(0, 900)
            }
        );

        await ctx.telegram.deleteMessage(
            ctx.chat.id,
            waitMsg.message_id
        ).catch(() => {});

    } catch (error) {
        console.error('[Music Error]', errorReason(error));

        const message = error.code === 'AUDIO_UNAVAILABLE'
            ? '❌ Audio ဆာဗာများမှ ဖိုင်မရနိုင်ပါ။\n' +
              'ခဏကြာမှ ပြန်စမ်းပေးပါ။\n' +
              'အသေးစိတ်အကြောင်းရင်းကို Server Logs မှာ ကြည့်နိုင်ပါတယ်။'
            : '❌ သီချင်းရယူခြင်း သို့မဟုတ် ပို့ခြင်း မအောင်မြင်ပါ။\n' +
              'အသေးစိတ်အကြောင်းရင်းကို Server Logs မှာ ကြည့်နိုင်ပါတယ်။';

        if (waitMsg) {
            await updateStatus(ctx, waitMsg.message_id, message);
        } else {
            await safeReply(ctx, message);
        }

    } finally {
        if (tempDir) {
            await fsp.rm(tempDir, {
                recursive: true,
                force: true
            }).catch(() => {
                console.warn('[Cleanup] ယာယီဖိုင် မရှင်းနိုင်ပါ');
            });
        }

        activeUsers.delete(userId);
    }
});

// Token ပါနိုင်တဲ့ error object အပြည့်အစုံကို မထုတ်ပါ။
bot.catch(error => {
    console.error('[Bot Error]', errorReason(error));
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

bot.launch().catch(error => {
    console.error('[Launch Error]', errorReason(error));
    process.exitCode = 1;
});