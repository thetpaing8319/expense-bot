require('dotenv').config();
const { Telegraf } = require('telegraf');
const ytSearch = require('yt-search');
const axios = require('axios');

if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN မရှိပါ!');
const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => ctx.reply('🎵 Music Bot မှ ကြိုဆိုပါတယ်။\nသီချင်းရှာရန် ဥပမာ: /play လွမ်းရက်တွေ ဟု ရိုက်ထည့်ပါ။'));

bot.command('play', async (ctx) => {
    const query = ctx.message.text.split(' ').slice(1).join(' ');
    if (!query) return ctx.reply('ကျေးဇူးပြု၍ သီချင်းနာမည် ရိုက်ထည့်ပါ။ ဥပမာ: /play လွမ်းရက်တွေ');

    const waitMsg = await ctx.reply('🔍 သီချင်းရှာနေပါတယ်... ခဏစောင့်ပါဗျ။');

    try {
        // ၁။ YouTube တွင် သီချင်းနာမည် အတိအကျရှာခြင်း
        const ytResult = await ytSearch(query);
        const video = ytResult.videos.length > 0 ? ytResult.videos[0] : null;

        if (!video) {
            return ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, '❌ သီချင်းရှာမတွေ့ပါဘူးဗျ။');
        }

        await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, `🎧 **${video.title}** ကို ဆွဲယူနေပါသည်...`);

        // ၂။ Cobalt API ကိုသုံး၍ YouTube မှ MP3 Direct Link ပြောင်းယူခြင်း (Railway IP ပိတ်ခြင်းကို ကျော်လွှားရန်)
        const response = await axios.post('https://api.cobalt.tools/api/json', {
            url: video.url,
            isAudioOnly: true
        }, {
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        if (!response.data || !response.data.url) {
            throw new Error("Cobalt API မှ Link မရရှိပါ။");
        }

        await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, `📤 Telegram သို့ ပို့နေပါပြီ...`);

        // ၃။ ရလာသော Direct Link ကို Telegram သို့ တိုက်ရိုက်ပို့ခြင်း (သင့်စက်မှ ဒေါင်းလုဒ်ဆွဲစရာမလိုတော့ပါ)
        await ctx.replyWithAudio({
            url: response.data.url
        }, {
            title: video.title,
            performer: video.author.name
        });

        await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id);

    } catch (error) {
        console.error("General Error:", error.message);
        ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, '❌ ဒေါင်းလုဒ်ဆွဲရာတွင် အမှားအယွင်းဖြစ်သွားပါတယ်။ တခြားသီချင်း ပြောင်းရှာကြည့်ပါ။');
    }
});

bot.launch().then(() => console.log('Music Bot is running with Cobalt API...')).catch(err => console.error(err));