
var Mopidy = require("mopidy");
var Slack = require("slack-client");
var Miles = require("./miles");
var Echojs = require('echojs');

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
}

miles.command("current", function() {
    var channel = this.channel;
    this.mopidy.playback.getCurrentTrack().then(function(data) {
        channel.send("Currently playing " + getLink(data.uri));
    });
});

miles.command("play", function() {
    this.mopidy.playback.play();
});

miles.command("pause", function() {
    this.mopidy.playback.pause();
});

miles.command("clear", function() {
    this.mopidy.tracklist.clear();
});

miles.command("random", function() {
    this.mopidy.tracklist.getRandom().then(function(data){
        console.log(data);
    });
});

miles.command("queue songs by artists like {artist}", function(artist) {
    var channel = this.channel;
    echo('playlist/static').get({
        bucket: ['id:spotify', 'tracks'],
        type: 'artist-radio',
        limit: true,
        artist: [artist]
    }, function(err, json) {
        var trackUris = [];
        var trackNames = [];
        json.response.songs.forEach(function(song) {
            trackUris.push(song.tracks[0].foreign_id);
            trackNames.push(song.artist_name + " - " + song.title);
        });
        console.log(trackUris);
        console.log(trackNames);
        mopidy.tracklist.add({uris: trackUris}).then(function() {
            channel.send("Queued:\n" + trackNames.join("\n"));
        });        
    });
})

miles.command("tracks", function() {
    this.mopidy.tracklist.getTracks().then(function(data) {
        console.log(data);
    });
});

miles.command("tltracks", function() {
    this.mopidy.tracklist.getTlTracks().then(function(data) {
        console.log(data);
    });
});

miles.command("random on", function() {
    this.mopidy.tracklist.setRandom({value: true});
});

miles.command("random off", function() {
    this.mopidy.tracklist.setRandom({value: false});
});

miles.command("prev|back", function() {
    this.mopidy.playback.previous();
});

miles.command("skip|next", function() {
    this.mopidy.playback.next();
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

miles.command("queue album {album} by {artist}", function(album, artist) {
    var channel = this.channel;
    this.mopidy.library.search({query: {album: [album], artist: [artist]}, uris: ["spotify:"]}).then(function(data) {

        var firstAlbum = data[0].albums[0].uri; // todo?
        console.log(firstAlbum);
        mopidy.tracklist.add({uris: [firstAlbum]}).then(function() {
            channel.send("Added " + getLink(firstAlbum));
        });
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
