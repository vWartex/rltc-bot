const { Client, GatewayIntentBits, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionFlagsBits } = require('discord.js');
const express = require('express');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// Enkel webbserver för att hålla Render/Koyeb glada
const app = express();
app.get('/', (req, res) => res.send('RLTC Bot is online 24/7!'));
app.listen(process.env.PORT || 3000);

// Databaser i minnet (För en helt stabil molndrift)
const db = new Map();
const activeLfps = new Map();

// --- 1. PROFIL & EKONOMI LOGIK ---
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    // XP System
    let user = db.get(message.author.id) || { xp: 0, level: 1, credits: 0, badges: [], cooldowns: {} };
    user.xp += Math.floor(Math.random() * 11) + 15; // 15-25 XP
    
    // Level up logik med Ranks
    const xpNeeded = user.level * 100;
    if (user.xp >= xpNeeded) {
        user.xp -= xpNeeded;
        user.level++;
        let rank = 'Bronze';
        if (user.level > 5) rank = 'Silver';
        if (user.level > 10) rank = 'Gold';
        if (user.level > 15) rank = 'Platinum';
        if (user.level > 25) rank = 'Diamond';
        if (user.level > 50) rank = 'Champion';
        if (user.level > 75) rank = 'Grand Champion';
        if (user.level > 100) rank = 'SSL'
        message.reply(`🎉 **Level Up!** You are now Level ${user.level} (${rank})!`);
    }
    db.set(message.author.id, user);

    // TEXTBASERADE KOMMANDON (För att garantera 100% funktion på alla servrar direkt)
    const args = message.content.split(' ');
    const command = args[0].toLowerCase();

    if (command === '!work') {
        let u = db.get(message.author.id) || { credits: 0, cooldowns: {} };
        const now = Date.now();
        if (u.cooldowns.work && now < u.cooldowns.work) {
            const minutesLeft = Math.ceil((u.cooldowns.work - now) / 60000);
            return message.reply(`⏳ You have to wait ${minutesLeft} minutes before you can work again!`);
        }
        const earned = Math.floor(Math.random() * 401) + 100; // 100-500
        u.credits += earned;
        u.cooldowns.work = now + 30 * 60000; // 30 min
        db.set(message.author.id, u);
        message.reply(`💼 **Job:** You coached a player and earned **${earned}** Credits!`);
    }

    if (command === '!balance') {
        let u = db.get(message.author.id) || { credits: 0 };
        message.reply(`💳 You have right now **${u.credits}** Credits on your account.`);
    }

    // --- VERIFIERING SETUP ---
    if (command === '!setup-verify' && message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        const embed = new EmbedBuilder()
            .setTitle('🔒 Verifiering Required')
            .setDescription('Welcome to the training camp! Click the button below to verify that you are not a bot and gain access to the server.')
            .setColor('#2ecc71');
        const btn = new ButtonBuilder().setCustomId('verify-btn').setLabel('Verify 🔑').setStyle(ButtonStyle.Success);
        const row = new ActionRowBuilder().addComponents(btn);
        message.channel.send({ embeds: [embed], components: [row] });
    }

    // --- LFG SETUP ---
    if (command === '!lfg') {
        const slots = parseInt(args[1]) || 1;
        const rank = args[2] || 'Valfri';
        const lfgId = `lfg-${message.id}`;
        
        activeLfps.set(lfgId, { host: message.author.id, rank: rank, slots: slots, players: [] });
        
        const embed = new EmbedBuilder()
            .setTitle('🏎️ Ny LFG-sökning!')
            .setDescription(`<@${message.author.id}> looking for teammates!`)
            .addFields(
                { name: '🎯 Rank', value: rank, inline: true },
                { name: '👥 Places left', value: `${slots} st`, inline: true },
                { name: 'Team members', value: 'None yet...' }
            ).setColor('#0099ff');
            
        const btn = new ButtonBuilder().setCustomId(`join-${lfgId}`).setLabel('Join the team! 🎮').setStyle(ButtonStyle.Primary);
        const row = new ActionRowBuilder().addComponents(btn);
        message.channel.send({ embeds: [embed], components: [row] });
    }
});

// --- INTERAKTIONER (Knappar) ---
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'verify-btn') {
        let role = interaction.guild.roles.cache.find(r => r.name === 'Verified');
        if (!role) {
            role = await interaction.guild.roles.create({ name: 'Verified', color: '#808080' });
        }
        await interaction.member.roles.add(role.id);
        await interaction.reply({ content: '🎉 You are now verified! Welcome in!', ephemeral: true });
    }

    if (interaction.customId.startsWith('join-')) {
        const lfgId = interaction.customId.replace('join-', '');
        const lfg = activeLfps.get(lfgId);
        if (!lfg) return interaction.reply({ content: 'This search is closed.', ephemeral: true });
        if (interaction.user.id === lfg.host) return interaction.reply({ content: 'You cannot join your own team!', ephemeral: true });
        if (lfg.players.includes(interaction.user.id)) return interaction.reply({ content: 'You are already in the queue!', ephemeral: true });

        lfg.players.push(interaction.user.id);
        lfg.slots--;

        if (lfg.slots <= 0) {
            const mentions = lfg.players.map(id => `<@${id}>`).join(', ');
            await interaction.message.channel.send(`🎉 **The team is full!** <@${lfg.host}> och ${mentions}, jump into the voice channel!`);
            
            // AVANCERAD AUTOMATISK RÖSTFLYTT-LOGIK
            try {
                const voiceChannel = await interaction.guild.channels.create({
                    name: `🎮 Team ${interaction.user.username}`,
                    type: 13 // Stage/Voice channel
                });
                const hostMember = await interaction.guild.members.fetch(lfg.host);
                if (hostMember.voice.channel) await hostMember.voice.setChannel(voiceChannel.id);
                for (const pId of lfg.players) {
                    const m = await interaction.guild.members.fetch(pId);
                    if (m.voice.channel) await m.voice.setChannel(voiceChannel.id);
                }
            } catch (e) { console.log("Could not move to voice channel automatically : " + e.message); }
            
            activeLfps.delete(lfgId);
        } else {
            await interaction.reply({ content: 'You have joined the queue! ', ephemeral: true });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
