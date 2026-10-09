require('dotenv').config();
const { Telegraf } = require('telegraf');
const ytSearch = require('yt-search');
const axios = require('axios');

if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN မရှိပါ!');
const bot = new Telegraf(process.env.BOT_TOKEN);

// အသုံးပြုမည့် Invidious API ဆာဗာများ
const INVIDIOUS_INSTANCES = [
    'https://invidious.jing.rocks',
    'https://inv.tux.pizza',
    'https://vid.puffyan.us',
    'https://invidious.private.coffee'
];

bot.start((ctx) => ctx.reply('🎵 Music Bot မှ ကြိုဆိုပါတယ်။\nသီချင်းရှာရန်: /play သီချင်းနာမည် ဟု ရိုက်ထည့်ပါ။'));

bot.command('play', async (ctx) => {
    const query = ctx.message.text.split(' ').slice(1).join(' ');
    if (!query) return ctx.reply('ကျေးဇူးပြု၍ သီချင်းနာမည် ရိုက်ထည့်ပါ။ ဥပမာ: /play perfect');

    const waitMsg = await ctx.reply('🔍 သီချင်းရှာနေပါတယ်... ခဏစောင့်ပါဗျ။');

    try {
        // ၁။ YouTube တွင် ရှာဖွေပြီး Video ID ရယူခြင်း
        const ytResult = await ytSearch(query);
        const video = ytResult.videos.length > 0 ? ytResult.videos[0] : null;

        if (!video) {
            return ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, '❌ သီချင်းရှာမတွေ့ပါဘူးဗျ။');
        }

        await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, `🎧 **${video.title}** ကို ရှာဖွေရရှိပါပြီ... ဒေါင်းလုဒ်ပြင်ဆင်နေပါသည်`);

        // ၂။ Invidious Instance များမှတစ်ဆင့် Audio URL ရယူခြင်း
        let audioUrl = null;
        for (const instance of INVIDIOUS_INSTANCES) {
            try {
                const res = await axios.get(`${instance}/api/v1/videos/${video.videoId}`, { timeout: 6000 });
                if (res.data && res.data.adaptiveFormats) {
                    // Audio stream ကို ရွေးထုတ်ခြင်း
                    const audioFormat = res.data.adaptiveFormats
                        .filter(f => f.type && f.type.startsWith('audio/'))
                        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];

                    if (audioFormat && audioFormat.url) {
                        audioUrl = audioFormat.url;
                        break;
                    }
                }
            } catch (err) {
                // တခြား server သို့ ဆက်လက်ကြိုးစားမည်
                continue;
            }
        }

        if (!audioUrl) {
            throw new Error("ဆာဗာများအားလုံးမှ Audio Link မရရှိနိုင်ပါ။");
        }

        await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, `📤 Telegram သို့ ပို့နေပါပြီ...`);

        // ၃။ တိုက်ရိုက် Audio Link အား Telegram သို့ ပို့ဆောင်ခြင်း
        await ctx.replyWithAudio({
            url: audioUrl
        }, {
            title: video.title,
            performer: video.author.name
        });

        await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id);

    } catch (error) {
        console.error("Music Error:", error.message);
        ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, '❌ ဒေါင်းလုဒ်ဆွဲရာတွင် အမှားအယွင်းဖြစ်သွားပါသည်။ အခြားသီချင်းခေါင်းစဉ်ဖြင့် ပြန်လည်စမ်းသပ်ကြည့်ပါ။');
    }
});

bot.launch().then(() => console.log('Music Bot is running via Invidious stream...')).catch(err => console.error(err));