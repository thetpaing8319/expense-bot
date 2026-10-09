require('dotenv').config();
const { Telegraf } = require('telegraf');
const ytSearch = require('yt-search');
const axios = require('axios');

if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN မရှိပါ!');
const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => ctx.reply('🎵 Music Bot မှ ကြိုဆိုပါတယ်။\nသီချင်းရှာရန်: /play သီချင်းနာမည် ဟု ရိုက်ထည့်ပါ။'));

bot.command('play', async (ctx) => {
    const query = ctx.message.text.split(' ').slice(1).join(' ');
    if (!query) return ctx.reply('ကျေးဇူးပြု၍ သီချင်းနာမည် ရိုက်ထည့်ပါ။ ဥပမာ: /play perfect');

    const waitMsg = await ctx.reply('🔍 သီချင်းရှာနေပါတယ်... ခဏစောင့်ပါဗျ။');

    try {
        const ytResult = await ytSearch(query);
        const video = ytResult.videos.length > 0 ? ytResult.videos[0] : null;

        if (!video) {
            return ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, '❌ သီချင်းရှာမတွေ့ပါဘူးဗျ။');
        }

        await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, `🎧 **${video.title}** ကို ဆွဲယူနေပါသည်...`);

        // Cobalt API v10 format ဖြင့် တောင်းဆိုခြင်း
        const response = await axios.post('https://api.cobalt.tools/', {
            url: video.url,
            downloadMode: 'audio',
            audioFormat: 'mp3'
        }, {
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        const downloadUrl = response.data?.url;
        if (!downloadUrl) {
            throw new Error("Download link မရရှိပါ။");
        }

        await ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, `📤 Telegram သို့ ပို့နေပါပြီ...`);

        await ctx.replyWithAudio({
            url: downloadUrl
        }, {
            title: video.title,
            performer: video.author.name
        });

        await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id);

    } catch (error) {
        console.error("General Error:", error.response?.data || error.message);
        ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, undefined, '❌ ဒေါင်းလုဒ်ဆွဲရာတွင် အမှားအယွင်းဖြစ်သွားပါသည်။');
    }
});

bot.launch().then(() => console.log('Music Bot is running...')).catch(err => console.error(err));