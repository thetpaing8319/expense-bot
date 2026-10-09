require('dotenv').config();
const { Telegraf } = require('telegraf');
const ytSearch = require('yt-search');
const axios = require('axios');
const fs = require('fs');

if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN မရှိပါ!');
const bot = new Telegraf(process.env.BOT_TOKEN);

// Piped API ဆာဗာများ (YouTube ကို ကျော်ဖြတ်ရန်)
const PIPED_INSTANCES = [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.tokhmi.xyz',
    'https://api.piped.projectsegfau.lt'
];

bot.start((ctx) => ctx.reply('🎵 Music Bot မှ ကြိုဆိုပါတယ်။\nသီချင်းရှာရန်: /play သီချင်းနာမည် ဟု ရိုက်ထည့်ပါ။'));

bot.command('play', async (ctx) => {
    const query = ctx.message.text.split(' ').slice(1).join(' ');
    if (!query) return ctx.reply('ကျေးဇူးပြု၍ သီချင်းနာမည် ရိုက်ထည့်ပါ။ ဥပမာ: /play perfect');

    const waitMsg = await ctx.reply('🔍 သီချင်းရှာနေပါတယ်... ခဏစောင့်ပါဗျ။');

    try {
        // ၁။ YouTube မှ သီချင်း Video ID ရှာဖွေခြင်း
        const ytResult = await ytSearch(query);
        const video = ytResult.videos.length > 0 ? ytResult.videos[0] : null;

        if (!video) {
            return ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, '❌ သီချင်းရှာမတွေ့ပါဘူးဗျ။');
        }

        await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, `🎧 **${video.title}** ကို ရှာဖွေရရှိပါပြီ... ဒေါင်းလုဒ်ပြင်ဆင်နေပါသည်`);

        // ၂။ Piped API များကိုသုံး၍ Audio Link ရယူခြင်း
        let audioUrl = null;
        for (const instance of PIPED_INSTANCES) {
            try {
                const res = await axios.get(`${instance}/streams/${video.videoId}`, { timeout: 10000 });
                if (res.data && res.data.audioStreams && res.data.audioStreams.length > 0) {
                    // m4a format ကို ဦးစားပေးရွေးချယ်ပါ (Telegram အတွက် အဆင်ပြေဆုံး)
                    const stream = res.data.audioStreams.find(s => s.mimeType.includes('audio/mp4'));
                    if (stream && stream.url) {
                        audioUrl = stream.url;
                        break; // Link ရရင် ရပ်မယ်
                    }
                }
            } catch (err) {
                continue; // အလုပ်မလုပ်ရင် နောက်ဆာဗာတစ်ခု ပြောင်းစမ်းမယ်
            }
        }

        if (!audioUrl) {
            throw new Error("ဆာဗာများအားလုံးမှ Audio Link မရရှိနိုင်ပါ။");
        }

        await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, `📥 သီချင်းဖိုင်ကို ဒေါင်းလုဒ်ဆွဲနေပါသည်... (စက္ကန့်အနည်းငယ် ကြာနိုင်ပါသည်)`);

        // ၃။ Audio Link မှ ဖိုင်ကို Bot ထဲသို့ တိုက်ရိုက်ဆွဲချခြင်း
        const fileName = `./${Date.now()}.m4a`;
        const response = await axios({
            method: 'GET',
            url: audioUrl,
            responseType: 'stream'
        });

        const writer = fs.createWriteStream(fileName);
        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, `📤 Telegram သို့ ပို့နေပါပြီ...`);

        // ၄။ Telegram သို့ ပို့ဆောင်ခြင်း
        await ctx.replyWithAudio({
            source: fileName
        }, {
            title: video.title,
            performer: video.author.name
        });

        // ၅။ ပို့ပြီးတာနဲ့ ဖိုင်ကို ပြန်ဖျက်ခြင်း (Server နေရာမပြည့်အောင်)
        if (fs.existsSync(fileName)) fs.unlinkSync(fileName);
        await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id);

    } catch (error) {
        console.error("Music Error:", error.message);
        ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, '❌ အမှားအယွင်းဖြစ်သွားပါသည်။ အခြားသီချင်းခေါင်းစဉ်ဖြင့် ပြန်လည်စမ်းသပ်ကြည့်ပါ။');
    }
});

bot.launch().then(() => console.log('Music Bot is running successfully...')).catch(err => console.error(err));