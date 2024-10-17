// harmonix-backend/index.js

import express, { json } from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import querystring from 'querystring';
import axios from 'axios';
import OpenAI from 'openai';
const openai = new OpenAI();

config();
const app = express();
const PORT = process.env.PORT || 5000;

const SPOTIFY_AUTH_ENDPOINT = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API_ENDPOINT = 'https://api.spotify.com/v1/me';

app.use(cors());
app.use(json());

app.get('/', (req, res) => {
    res.send(`Harmonix Backend is Running! ${process.env.TEST}`);
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

// OpenAI API endpoint
app.post('/generate-playlist', async (req, res) => {
    const { prompt } = req.body;
    try {
        
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "You are a music recommendation assistant. When given a theme or mood, you will generate a playlist of 20 songs formatted as a list of JSON objects with each object containing 'title' and 'artist' fields. Do not return anything other that the JSON objects." },
                {
                    role: "user",
                    content: `Create a playlist for ${prompt}. Provide 20 songs in the following format: [{\"title\": \"Song Title 1\", \"artist\": \"Artist Name 1\"}, ...]`
                },
            ],
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.GPT_API_KEY}`
            }
    });
        const playlist = JSON.parse(completion.choices[0].message.content);
        res.json({ playlist });
    } catch (error) {
        res.status(500).json({ error: 'Error generating playlist' });
    }
});

// Spotify Authentication Route
app.get('/spotify/login', (req, res) => {
    const scope = 'user-read-private user-read-email';
    const queryParams = querystring.stringify({
        client_id: process.env.SPOTIFY_CLIENT_ID,
        response_type: 'code',
        redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
        scope: scope,
    });
    res.redirect(`${SPOTIFY_AUTH_ENDPOINT}?${queryParams}`);
});

// Spotify Callback Route
app.get('/spotify/callback', async (req, res) => {
    const code = req.query.code || null;

    const authOptions = {
        url: SPOTIFY_TOKEN_ENDPOINT,
        method: 'post',
        params: {
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
        },
        headers: {
            'Authorization': 'Basic ' + Buffer.from(process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET).toString('base64'),
            'Content-Type': 'application/x-www-form-urlencoded'
        },
    };

    try {
        const tokenResponse = await axios(authOptions);
        const accessToken = tokenResponse.data.access_token;

        // Store or use accessToken here as needed. For now, redirect back to frontend with token as query param
        res.redirect(`http://localhost:5173?access_token=${accessToken}`);
    } catch (error) {
        console.error('Error exchanging code for token:', error);
        res.status(500).send('Authentication failed');
    }
});

// Endpoint to Fetch Spotify User Info
app.get('/spotify/user', async (req, res) => {
    const accessToken = req.headers.authorization.split(' ')[1];

    try {
        const userResponse = await axios.get(SPOTIFY_API_ENDPOINT, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });
        res.json(userResponse.data);
    } catch (error) {
        console.error('Error fetching Spotify user data:', error);
        res.status(500).send('Failed to fetch user data');
    }
});

