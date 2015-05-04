
function Command(initiator, callback) {
    this.initiator = initiator;
    this.callback = callback;
    if (typeof initiator === "string") {
        this.regex = createRegexInitiator(initiator);
    }
};

Command.prototype.toString = function() {
    return this.initiator.toString();
}

Command.prototype.canExecute = function(message) {
    return this.regex.test(message);
};

Command.prototype.extractArgs = function (message) {
    var args = this.regex.exec(message);
    args.shift();
    return args;
};

Command.prototype.execute = function(args, context) {
    this.callback.apply(context, args);
};

function createRegexInitiator(initiator) {
    return new RegExp("^" + initiator.replace(/\{[^}]+\}/g, "(.+)") + "$", "i");
};

function Miles(slack, mopidy) {
    this.slack = slack;
    this.mopidy = mopidy;
    this.commands = [];
    this.mopidyConnected = false;

    mopidy.on("state:online", (function () {
        this.mopidyConnected = true;
    }).bind(this));

    mopidy.on("state:offline", (function () {
        this.mopidyConnected = false;
    }).bind(this));

    slack.on('message', (function(message) {
        this.dispatch(message)
    }).bind(this));
};

Miles.prototype.command = function(initiator, callback) {
    var command = new Command(initiator, callback);
    this.commands.push(command);
    return command;
};

var addTracks = function(tracks) {
    var channel = this.channel;
    if (tracks.length > 0) {

        var trackUris = tracks.map(function(track) {
            return track.uri;
        });
        var trackNames = tracks.map(function(track) {
            return track.name;
        });

        this.mopidy.tracklist.add({uris: trackUris}).then(function() {

            channel.postMessage({
                'text': ":notes: Queuing " + tracks.length + " songs :notes:",
                'as_user': true,
                'attachments': [{"text": trackNames.join("\n")}]
            });
        });            
    } else {
        channel.send("I didn't find anything to queue :frowning:");
    }
};


Miles.prototype.dispatch = function(message) {

    if (!isDirectedAtMe(this.slack.self.id, message.text)) {
        return;
    }

    var initiator = cleanMessage(message.text);

    var messageUser = function(text) {
        this.slack.openDM(message.user, (function(result) {
            var dm = this.slack.getChannelGroupOrDMByID(result.channel.id);
            dm.send(text);
        }).bind(this));        
    };

    var execute = function(cmd) {
        
    };

    var context = {
        slack: this.slack,
        mopidy: this.mopidy,
        commands: this.commands,
        message: message,
        channel: this.slack.getChannelGroupOrDMByID(message.channel),
        user: this.slack.getUserByID(message.user),
        messageUser: messageUser
    };
    context.addTracks = addTracks.bind(context);
    
    var foundCommand = false;
    for (var i = 0; i < this.commands.length; i++) {
        var command = this.commands[i];

        if (command.canExecute(initiator)) {
            var args = command.extractArgs(initiator);
            command.execute(args, context);
            foundCommand = true;
            break;
        }
    }

    if (!foundCommand) {

    }
}

function isDirectedAtMe(id, message) {
    var me = "<@" + id + ">"; 
    return message && message.slice(0, me.length) == me;
}

function cleanMessage(message) {
    return message
        .replace(/^<[@\w]+>:?\s*/, '') // remove username from start
        .replace(/<([^>]+)>/, '$1'); // remove formatting around links
}

Miles.prototype.run = function() {
    this.slack.login();
    this.mopidy.connect();
}

module.exports = Miles;
