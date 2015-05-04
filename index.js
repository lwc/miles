
var Mopidy = require("mopidy");
var Slack = require("slack-client");
var Miles = require("./miles");
var Echojs = require('echojs');
var spotifyUri = require('spotify-uri');

var config = require('./config');

var mopidy = new Mopidy({
    webSocketUrl: "ws://localhost:6680/mopidy/ws", 
    autoConnect: false,
    callingConvention: "by-position-or-by-name"
});

var slack = new Slack(config.SLACK_KEY, true, true);

var echo = Echojs({
    key: config.ECHONEST_KEY
});

var miles = new Miles(slack, mopidy);

var getLink = function(mopidyUri) {
    return mopidyUri.replace(/spotify:(.+):(.+)/, "https://play.spotify.com/$1/$2");
};

var getTrackName = function(track) {
    if (track.artists && track.artists[0]) {
        return track.artists[0].name + " - " + track.name;
    }
    return track.name;
};

miles.command("current", function() {
    var channel = this.channel;
    this.mopidy.playback.getCurrentTrack().then(function(data) {
        if (data && data.name) {
            var image = null;

            if (data.album.images) {
                image = data.album.images[0];
            }

            var fields = [
                {
                    title: "Title",
                    value: data.name,
                    short: true
                },
                {
                    title: "Album",
                    value: data.album.name,
                    short: true
                }
            ];
            if (data.artists && data.artists[0]) {
                fields.push({
                    title: "Artist",
                    value: data.artists[0].name,
                    short: true          
                });
            }
            if (data.date) {
                fields.push({
                    title: "Year",
                    value: data.date,
                    short: true               
                });
            }

            channel.postMessage({
                text: ":notes: Currently playing :notes:",
                as_user: true,
                attachments: [{fields: fields}],
                image_url: image
            });

        } else {
            channel.send("Nothing playing :frowning:");    
        }
    });
});

miles.command("play", function() {
    this.mopidy.playback.play();
});

miles.command("pause", function() {
    this.mopidy.playback.pause();
});

miles.command("prev|back", function() {
    this.mopidy.playback.previous();
});

miles.command("skip|next", function() {
    this.mopidy.playback.next();
});

miles.command("clear", function() {
    this.mopidy.tracklist.clear();
});

miles.command("random", function() {
    this.mopidy.tracklist.getRandom().then(function(data){
        console.log(data);
    });
});

miles.command("random on", function() {
    this.mopidy.tracklist.setRandom({value: true});
});

miles.command("random off", function() {
    this.mopidy.tracklist.setRandom({value: false});
});

miles.command("volume", function() {
    var channel = this.channel;
    this.mopidy.mixer.getVolume().then(function(vol) {
        channel.send("The volume is at " + vol + "%");
    });
});

miles.command("volume {percent}", function(percent) {
    var channel = this.channel;
    this.mopidy.mixer.setVolume({volume: parseInt(percent, 10)}).then(function() {
        channel.send("Volume set to " + percent + "%");
    });
});

miles.command("search genres {term}", function(term) {
    var channel = this.channel;

    echo('genre/search').get({
        bucket: ['description'],
        name: term
    }, function(err, json) {

        if (json.response && json.response.genres) {
            channel.postMessage({
                'text': ":notes: Genre information :notes:",
                'as_user': true,
                'attachments': [{"fields": json.response.genres.map(function(genre) {
                    return {
                        title: genre.name,
                        value: genre.description
                    }
                })}]
            });
        }
    });
});

miles.command("queue artist {artist}", function(artist) {
    var channel = this.channel;
    var addTracks = this.addTracks;    
    this.mopidy.library.search({query: {artist: [artist]}, uris: ["spotify:"], exact: true}).then(function(data) {

        var tracks = [];
        data.forEach(function(searchResult) {
            if (searchResult.tracks) {
                searchResult.tracks.forEach(function(track) {
                    if (track.artists[0] && artist.toLowerCase() === track.artists[0].name.toLowerCase()) {
                        tracks.push({
                            uri: track.uri,
                            name: getTrackName(track)
                        });
                    }
                });
            }
        });
        addTracks(tracks);
    });
});

miles.command("queue album {album} by {artist}", function(album, artist) {
    var channel = this.channel;
    this.mopidy.library.search({query: {album: [album], artist: [artist]}, uris: ["spotify:"]}).then(function(data) {

        if (data[0] && data[0].albums && data[0].albums[0]) {
            var firstAlbum = data[0].albums[0]; // todo?
            mopidy.tracklist.add({uris: [firstAlbum.uri]}).then(function() {
                channel.send(":notes: Queued " + getTrackName(firstAlbum));
            });            
        } else {
            channel.send("I didn't find anything to queue :frowning:");
        }
    });
});

miles.command("queue {genre} genre radio", function(genre) {
    var addTracks = this.addTracks;
    var channel = this.channel;
    channel.send(":notes: Creating genre radio :notes:");
    echo('playlist/static').get({
        bucket: ['id:spotify', 'tracks'],
        type: 'genre-radio',
        limit: true,
        results: 50,
        genre: [genre]
    }, function(err, json) {

        var tracks = [];
        json.response.songs.forEach(function(song) {
            tracks.push({
                uri: song.tracks[0].foreign_id,
                name: song.artist_name + " - " + song.title
            });
        });

        addTracks(tracks);
    });
});

miles.command("queue {artist} artist radio", function(artist) {
    var channel = this.channel;
    var addTracks = this.addTracks;
    channel.send(":notes: Creating artist radio :notes:");
    echo('playlist/static').get({
        bucket: ['id:spotify', 'tracks'],
        type: 'artist-radio',
        limit: true,
        results: 50,
        artist: [artist]
    }, function(err, json) {

        var tracks = [];
        json.response.songs.forEach(function(song) {
            tracks.push({
                uri: song.tracks[0].foreign_id,
                name: song.artist_name + " - " + song.title
            });
        });

        addTracks(tracks);
    });
});

miles.command("queue {url}", function(uri) {
    var channel = this.channel;
    var mopidy = this.mopidy;
    var addTracks = this.addTracks;

    // Normalise to spotify internal uris
    if (uri.search('spotify.com') !== -1) {
        uri = spotifyUri.formatURI(spotifyUri.parse(uri));
    }

    mopidy.library.search({query: {uri: [uri]}}).then(function(data) {

        var tracks = [];
        data.forEach(function(searchResult) {
            if (searchResult.tracks) {
                searchResult.tracks.forEach(function(track) {
                    tracks.push({
                        uri: track.uri,
                        name: getTrackName(track)
                    });
                });
            }
        });
        addTracks(tracks);
    });
});

miles.command("help", function() {
    var helpText = "Available Commands:\n\n";
    this.commands.forEach(function(command) {
        helpText += command.toString() + "\n";
    })
    this.messageUser(helpText);
});

miles.run();
