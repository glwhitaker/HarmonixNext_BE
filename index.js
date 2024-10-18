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
    res.send(`Harmonix Backend is Running!`);
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
                { 
                    role: "system", 
                    content: "You are a music recommendation assistant. When given a theme or mood, you will generate a playlist of 20 songs which embody the theme or mood given, formatted as a list of JSON objects with each object containing 'title' and 'artist' fields. Do not return anything other than the JSON objects." 
                },
                {
                    role: "user",
                    content: `Create a playlist for ${prompt}. Provide 20 popular songs that are likely to be available on Spotify, in the following format: [{\"title\": \"Song Title 1\", \"artist\": \"Artist Name 1\"}, ...]`
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
     // Add required scopes for playlist modification
        const scope = 'user-read-private user-read-email playlist-modify-public playlist-modify-private';
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

        // Fetch user profile to get the user ID
        const userResponse = await axios.get(SPOTIFY_API_ENDPOINT, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        const spotifyUserId = userResponse.data.id; // Extract user ID

        // Redirect back to frontend with access_token and user_id
        res.redirect(`http://localhost:5173?access_token=${accessToken}&user_id=${spotifyUserId}`);
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

// Endpoint to Create Spotify Playlist
app.post('/spotify/create-playlist', async (req, res) => {
    const { name, description, accessToken, userId } = req.body; // userId is passed from the client

    try {
        const response = await axios.post(
            `https://api.spotify.com/v1/users/${userId}/playlists`,
            {
                name: name,
                description: description,
                public: false // Make it private if you prefer
            },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                }
            }
        );
        res.json(response.data); // Send back the created playlist object
    } catch (error) {
        console.error('Error creating Spotify playlist:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Failed to create playlist' });
    }
});



// Endpoint to Add Tracks to Spotify Playlist
app.post('/spotify/add-tracks', async (req, res) => {
    const { playlistId, tracks, accessToken } = req.body;  // tracks are song titles and artists from OpenAI

    try {
        // Search each track and get the track URIs
        const trackUris = await Promise.all(tracks.map(async (track) => {
            try {
                const response = await axios.get(`https://api.spotify.com/v1/search`, {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                    },
                    params: {
                        q: `track:${track.title} artist:${track.artist}`,
                        type: 'track',
                        limit: 1,
                    }
                });
                
                // Check if the search result contains at least one track
                if (response.data.tracks.items.length > 0) {
                    return response.data.tracks.items[0].uri; // Get the track URI
                } else {
                    console.warn(`No track found for: ${track.title} by ${track.artist}`);
                    return null; // Return null if no track found
                }
            } catch (error) {
                console.error(`Error searching for track: ${track.title} by ${track.artist}`, error);
                return null; // Return null on error, so it doesn't break the Promise.all
            }
        }));

        // Filter out any null values (tracks that were not found)
        const validTrackUris = trackUris.filter(uri => uri !== null);

        // Log the playlistId and track URIs for debugging
        console.log('Playlist ID:', playlistId);
        console.log('Valid Track URIs:', validTrackUris);

        // If there are valid URIs, add them to the playlist
        if (validTrackUris.length > 0) {
            const addTracksResponse = await axios.post(
                `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
                {
                    uris: validTrackUris,
                },
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    }
                }
            );

            console.log('Spotify Add Tracks Response:', addTracksResponse.data);
            res.json({ message: 'Tracks added to playlist' });
        } else {
            res.status(404).json({ message: 'No valid tracks to add to the playlist.' });
        }
    } catch (error) {
        console.error('Error adding tracks to Spotify playlist:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Failed to add tracks' });
    }
});

