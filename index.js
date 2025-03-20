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
        const scope = 'user-read-private user-read-email playlist-modify-public playlist-modify-private user-library-read';
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



// New endpoint to validate tracks and get recommendations if needed
app.post('/validate-tracks', async (req, res) => {
    const { tracks, accessToken } = req.body;
    
    // Simple debug counters
    const stats = {
        totalRequested: tracks.length,
        validTracks: 0,
        invalidTracks: 0,
        recommendedTracks: 0
    };

    try {
        console.log(`[INFO] Validating ${tracks.length} tracks against Spotify`);
        
        // Step 1: Search and validate each track on Spotify
        const trackResults = await Promise.all(tracks.map(async (track) => {
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
                
                if (response.data.tracks.items.length > 0) {
                    const spotifyTrack = response.data.tracks.items[0];
                    stats.validTracks++;
                    
                    // Get the artist to extract genre information
                    const artistId = spotifyTrack.artists[0].id;
                    let genres = [];
                    
                    try {
                        const artistResponse = await axios.get(`https://api.spotify.com/v1/artists/${artistId}`, {
                            headers: {
                                Authorization: `Bearer ${accessToken}`,
                            }
                        });
                        
                        if (artistResponse.data && artistResponse.data.genres) {
                            genres = artistResponse.data.genres;
                            console.log(`[SUCCESS] Found genres for ${spotifyTrack.artists[0].name}: ${genres.join(', ')}`);
                        }
                    } catch (artistError) {
                        console.error(`[ERROR] Error getting artist genres: ${artistError.message}`);
                    }
                    
                    return {
                        title: spotifyTrack.name,
                        artist: spotifyTrack.artists[0].name,
                        album: spotifyTrack.album.name,
                        image: spotifyTrack.album.images[0]?.url,
                        uri: spotifyTrack.uri,
                        id: spotifyTrack.id,
                        artist_id: artistId,
                        genres: genres,
                        valid: true
                    };
                } else {
                    stats.invalidTracks++;
                    return { 
                        title: track.title, 
                        artist: track.artist,
                        valid: false 
                    };
                }
            } catch (error) {
                stats.invalidTracks++;
                return { 
                    title: track.title, 
                    artist: track.artist,
                    valid: false 
                };
            }
        }));

        // Filter valid tracks
        const validTracks = trackResults.filter(result => result.valid);
        
        console.log(`[SUCCESS] Found ${validTracks.length} valid tracks out of ${tracks.length}`);
        
        // Step 2: If we have fewer than 20 valid tracks, get tracks from similar genres
        let recommendedTracks = [];
        if (validTracks.length < 20 && validTracks.length > 0) {
            // Collect all genres from validated tracks
            const allGenres = [];
            validTracks.forEach(track => {
                if (track.genres && track.genres.length > 0) {
                    allGenres.push(...track.genres);
                }
            });
            
            // If we don't have any genres, use some popular ones as fallback
            if (allGenres.length === 0) {
                console.log('[WARNING] No genres found in validated tracks, using fallback genres');
                allGenres.push('pop', 'rock', 'hip hop', 'electronic', 'indie');
            }
            
            console.log(`[INFO] Found ${allGenres.length} total genres across all tracks`);
            
            // Get unique genres while preserving frequency (more common genres will appear more often)
            const uniqueGenres = [...allGenres];
            
            // Calculate how many more tracks we need
            const neededTracks = 20 - validTracks.length;
            console.log(`[INFO] Need to find ${neededTracks} more tracks to complete the playlist`);
            
            // Rotate through genres to find additional tracks
            let genreIndex = 0;
            let attempts = 0;
            const maxAttempts = uniqueGenres.length * 2; // Avoid infinite loop
            
            while (recommendedTracks.length < neededTracks && attempts < maxAttempts) {
                const currentGenre = uniqueGenres[genreIndex % uniqueGenres.length];
                genreIndex++;
                attempts++;
                
                try {
                    console.log(`[INFO] Searching for a track in genre: ${currentGenre}`);
                    
                    const response = await axios.get(`https://api.spotify.com/v1/search`, {
                        headers: {
                            Authorization: `Bearer ${accessToken}`,
                        },
                        params: {
                            q: `genre:${currentGenre}`,
                            type: 'track',
                            limit: 50 // Get more results to increase chance of finding unique tracks
                        }
                    });
                    
                    if (response.data.tracks.items.length > 0) {
                        // Filter out tracks we already have (both in validated and recommended)
                        const existingIds = [...validTracks, ...recommendedTracks].map(t => t.id);
                        const newTracks = response.data.tracks.items.filter(t => !existingIds.includes(t.id));
                        
                        if (newTracks.length > 0) {
                            // Pick a random track from the results to add variety
                            const randomIndex = Math.floor(Math.random() * newTracks.length);
                            const selectedTrack = newTracks[randomIndex];
                            
                            recommendedTracks.push({
                                title: selectedTrack.name,
                                artist: selectedTrack.artists[0].name,
                                album: selectedTrack.album.name,
                                image: selectedTrack.album.images[0]?.url,
                                uri: selectedTrack.uri,
                                id: selectedTrack.id,
                                genres: [currentGenre], // Store the genre we searched for
                                valid: true,
                                recommended: true
                            });
                            
                            console.log(`[SUCCESS] Added track "${selectedTrack.name}" by ${selectedTrack.artists[0].name} from genre ${currentGenre}`);
                        } else {
                            console.log(`[WARNING] No new tracks found for genre ${currentGenre}`);
                        }
                    } else {
                        console.log(`[WARNING] No tracks found for genre ${currentGenre}`);
                    }
                } catch (error) {
                    console.error(`[ERROR] Error searching for tracks in genre ${currentGenre}:`, error.message);
                    if (error.response) {
                        console.error(`Status: ${error.response.status}`);
                        console.error('Error data:', JSON.stringify(error.response.data));
                    }
                }
            }
            
            stats.recommendedTracks = recommendedTracks.length;
            console.log(`[SUCCESS] Added ${recommendedTracks.length} tracks from similar genres`);
        }

        // Combine valid tracks with recommended tracks
        const finalPlaylist = [...validTracks, ...recommendedTracks];
        
        // Return the validated playlist
        res.json({
            message: 'Tracks validated',
            stats: {
                originalRequested: stats.totalRequested,
                validOriginal: stats.validTracks,
                invalidOriginal: stats.invalidTracks,
                recommended: stats.recommendedTracks,
                totalValid: finalPlaylist.length
            },
            playlist: finalPlaylist
        });
    } catch (error) {
        console.error('[ERROR] Error validating tracks:', error.message);
        res.status(500).json({ 
            error: 'Failed to validate tracks',
            details: error.message
        });
    }
});

// Update the add-tracks endpoint to handle recommendations properly
app.post('/spotify/add-tracks', async (req, res) => {
    const { playlistId, tracks, accessToken } = req.body;
    
    // Simple debug counters
    const stats = {
        totalRequested: tracks.length,
        validTracks: 0,
        invalidTracks: 0,
        recommendedTracks: 0
    };

    try {
        console.log(`[INFO] Processing ${tracks.length} tracks for playlist ${playlistId}`);
        
        // Step 1: Validate each track
        const trackResults = await Promise.all(tracks.map(async (track) => {
            try {
                // If the track already has a URI, use it directly
                if (track.uri) {
                    // Check if it's a recommended track
                    if (track.recommended) {
                        stats.recommendedTracks++;
                    } else {
                        stats.validTracks++;
                    }
                    
                    return {
                        original: track,
                        valid: true,
                        uri: track.uri,
                        id: track.id,
                        recommended: !!track.recommended,
                        spotifyData: {
                            title: track.title,
                            artist: track.artist,
                            album: track.album || '',
                            image: track.image || ''
                        }
                    };
                }
                
                // Otherwise search for it
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
                
                if (response.data.tracks.items.length > 0) {
                    const spotifyTrack = response.data.tracks.items[0];
                    stats.validTracks++;
                    return {
                        original: track,
                        valid: true,
                        uri: spotifyTrack.uri,
                        id: spotifyTrack.id,
                        recommended: false,
                        spotifyData: {
                            title: spotifyTrack.name,
                            artist: spotifyTrack.artists[0].name,
                            album: spotifyTrack.album.name,
                            image: spotifyTrack.album.images[0]?.url
                        }
                    };
                } else {
                    stats.invalidTracks++;
                    return { original: track, valid: false };
                }
            } catch (error) {
                stats.invalidTracks++;
                return { original: track, valid: false };
            }
        }));

        // Filter valid tracks
        const validTracks = trackResults.filter(result => result.valid && !result.recommended);
        const recommendedTracks = trackResults.filter(result => result.valid && result.recommended);
        
        // Extract URIs, ensuring they're in the correct format
        const validTrackUris = validTracks.map(track => track.uri);
        const recommendedTrackUris = recommendedTracks.map(track => track.uri);
        
        // Combine all URIs
        const allTrackUris = [...validTrackUris, ...recommendedTrackUris];
        
        console.log(`[SUCCESS] Found ${validTracks.length} valid original tracks and ${recommendedTracks.length} recommended tracks`);
        
        // Add tracks to the playlist if we have any
        if (allTrackUris.length > 0) {
            console.log(`[INFO] Adding ${allTrackUris.length} total tracks to playlist`);
            
            // Log the first few URIs for debugging
            console.log(`[DEBUG] First few URIs: ${allTrackUris.slice(0, 3).join(', ')}`);
            
            await axios.post(
                `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
                {
                    uris: allTrackUris,
                },
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    }
                }
            );
            
            // Return both valid original tracks and recommended tracks
            res.json({
                message: 'Tracks added to playlist',
                stats: {
                    originalRequested: stats.totalRequested,
                    validOriginal: stats.validTracks,
                    invalidOriginal: stats.invalidTracks,
                    recommended: stats.recommendedTracks,
                    totalAdded: allTrackUris.length
                },
                validOriginalTracks: validTracks.map(t => ({
                    title: t.spotifyData.title,
                    artist: t.spotifyData.artist,
                    album: t.spotifyData.album,
                    image: t.spotifyData.image
                })),
                recommendedTracks: recommendedTracks.map(t => ({
                    title: t.spotifyData.title,
                    artist: t.spotifyData.artist,
                    album: t.spotifyData.album,
                    image: t.spotifyData.image,
                    recommended: true
                }))
            });
        } else {
            console.log('[ERROR] No valid tracks found to add to the playlist');
            res.status(404).json({ 
                message: 'No valid tracks found to add to the playlist.',
                stats
            });
        }
    } catch (error) {
        console.error('[ERROR] Error adding tracks to Spotify playlist:', error.message);
        res.status(500).json({ 
            error: 'Failed to add tracks',
            details: error.message
        });
    }
});

// Get more tracks from the same artists
async function getMoreTracksFromArtists(validTracks, accessToken, limit) {
    const artistIds = [...new Set(validTracks
        .filter(track => track.artist_id) // Make sure we have artist IDs
        .map(track => track.artist_id))];
    
    if (artistIds.length === 0) return [];
    
    const artistTracks = [];
    
    // For each artist, get their top tracks
    for (const artistId of artistIds.slice(0, 5)) { // Limit to 5 artists to avoid too many requests
        try {
            const response = await axios.get(`https://api.spotify.com/v1/artists/${artistId}/top-tracks`, {
                headers: { 'Authorization': `Bearer ${accessToken}` },
                params: { market: 'US' }
            });
            
            if (response.data && response.data.tracks) {
                // Filter out tracks that are already in our validated list
                const newTracks = response.data.tracks
                    .filter(track => !validTracks.some(vt => vt.id === track.id))
                    .map(track => ({
                        title: track.name,
                        artist: track.artists[0].name,
                        album: track.album.name,
                        image: track.album.images[0]?.url,
                        uri: track.uri,
                        id: track.id,
                        valid: true,
                        recommended: true
                    }));
                
                artistTracks.push(...newTracks);
            }
        } catch (error) {
            console.error(`Error getting tracks for artist ${artistId}:`, error.message);
        }
    }
    
    return artistTracks.slice(0, limit);
}

// Get tracks by genre
async function getTracksByGenre(validTracks, accessToken, limit) {
    // First, get artist genres
    const artistIds = [...new Set(validTracks
        .filter(track => track.artist_id)
        .map(track => track.artist_id))];
    
    if (artistIds.length === 0) return [];
    
    let genres = [];
    
    // Get genres for each artist
    for (const artistId of artistIds.slice(0, 5)) {
        try {
            const response = await axios.get(`https://api.spotify.com/v1/artists/${artistId}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            
            if (response.data && response.data.genres) {
                genres.push(...response.data.genres);
            }
        } catch (error) {
            console.error(`Error getting genres for artist ${artistId}:`, error.message);
        }
    }
    
    // Get the most common genres
    const genreCounts = {};
    genres.forEach(genre => {
        genreCounts[genre] = (genreCounts[genre] || 0) + 1;
    });
    
    const topGenres = Object.entries(genreCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(entry => entry[0]);
    
    if (topGenres.length === 0) return [];
    
    // Search for tracks in these genres
    const genreTracks = [];
    
    for (const genre of topGenres) {
        try {
            const response = await axios.get(`https://api.spotify.com/v1/search`, {
                headers: { 'Authorization': `Bearer ${accessToken}` },
                params: {
                    q: `genre:${genre}`,
                    type: 'track',
                    limit: Math.ceil(limit / topGenres.length)
                }
            });
            
            if (response.data && response.data.tracks && response.data.tracks.items) {
                const newTracks = response.data.tracks.items
                    .filter(track => !validTracks.some(vt => vt.id === track.id))
                    .map(track => ({
                        title: track.name,
                        artist: track.artists[0].name,
                        album: track.album.name,
                        image: track.album.images[0]?.url,
                        uri: track.uri,
                        id: track.id,
                        valid: true,
                        recommended: true
                    }));
                
                genreTracks.push(...newTracks);
            }
        } catch (error) {
            console.error(`Error searching for tracks in genre ${genre}:`, error.message);
        }
    }
    
    return genreTracks.slice(0, limit);
}

