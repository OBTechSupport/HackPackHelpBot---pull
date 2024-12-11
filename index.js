// TODO:
// Check for message under current name before adding / moving
// If I want to add per-user storage, storage create messages from users if they are failed and insert them as starting point when they run create again.
// Lots of other limiting char counts
// Command to upload photos from photo database of different parts of each box?
// 

Object.assign(process.env, require('./env.json'));
var client;
const {Client, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, Partials, MessageAttachment, AttachmentBuilder } = require("discord.js");
const fs = require("fs");
const { get } = require('https');
const puppeteer = require('puppeteer'); // Import is needed here to set ENVs (temp dir)
const { getDescription, getHelpMessageTitlesArray, getHelpMessageBySubjectTitle, getFileContent, appendHelpMessage, editHelpMessage, getSubtopics } = require("./helpFileParse")
const { getChartOptions, getPathToFlowchart } = require("./flowcharter")
const subtopics = getSubtopics();
const Fuse = require('fuse.js');
const path = require("path")
const fuseOptions = {
    includeScore: true,
    keys: ['title']
};

const AuthorizedEditors = [// TODO: port to whitelist file with /whitelist devadmin command
    "724416180097384498",  // WKoA
    "1233957025256570951", // AshBro
    "1242941939662323774", // HeavyFalcon
    "1229105394849284127", // Dan
    "1242930479439544461", // Tom
    "145346537004728320",  // Sean
    "703724617583296613",  // Mark lol
]; // userIDs of those allowed to edit bot content storage

const MarkRobot = require("./markRobot")
const markRobotInstances = {}; // Technically it would be good to clean old convos every week or so



//
// If this is to be more widely used than just me and one or two other people, 
//  it should cache files, as well as Fuse instances. 
// If a command is then added to change the help files, clear cache / pull in new files so it is visible right away. 
// Also include a mod command to clear cache (in case files are changed directly)
// 


// Register client
client = new Client({
    intents: 0,
    partials: Object.keys(Partials).map(a=>Partials[a])
});


//#region functions
function sortByMatch(items, text) {
    if (!text) return items;
    const fuse = new Fuse(items.map(title => ({ title })), fuseOptions);            
    const scoredResults = fuse.search(text)
        .filter(result => result.score <= 2) // Roughly similar-ish
        .sort((a, b) => a.score - b.score);
    return scoredResults.map(entry => entry.item.title);
}
function arrayToAutocorrect(array) {
    const choices = array.map(choice => {
        return {
            "name": choice,
            "value": choice
        }
    });
    return choices.slice(0, 25); // Discord limit is 25 responses
}
async function downloadFile(fileUrl, downloadPath) {
    return new Promise((resolve, reject) => {
        // Ensure the download path exists
        const fullPath = path.resolve(downloadPath);

        // Create a write stream
        const file = fs.createWriteStream(fullPath);

        // Download the file
        get(fileUrl, (response) => {
            response.pipe(file);

            file.on('finish', () => {
                file.close();
                resolve(fullPath);
            });
        }).on('error', (err) => {
            file.close();
            reject(err);
        });
    });
}
//#endregion functions


// The meat of the code
var lastUser = "";
client.on("interactionCreate", async cmd => {
    const username = cmd?.member?.user?.username;
    if (username !== lastUser) {
        console.log(username);
        lastUser = username;
    }
    
    // Autocomplete interactions are requesting what to suggest to the user to put in a command's string option
    if (cmd.isAutocomplete()) {
        const field = cmd.options.getFocused(true);
        const typedSoFar = field.value;

        switch(field.name) { // we base the switch off what the the felid is, either a topic autocomplete or a title autocomplete
            case "title":
                var subtopic = cmd.options.getSubcommand(false);

                // If this is an edit command, we need to extract the subtopic from the subtopic field since it doesn't use subcommands
                if (!subtopic) {
                    subtopic = cmd.options.getString('subtopic') || "";
                    if (!subtopics.includes(subtopic)) {
                        cmd.respond(arrayToAutocorrect(["Subtopic not found"]));
                        break;
                    }
                }

                const helpFile = getFileContent(subtopic);
                var helpMessagesTitles = getHelpMessageTitlesArray(helpFile)

                // Now we're going to filter our suggestions by similar the things are to what they've typed so far
                if (typedSoFar) { // only refine if they've started typing
                    const fuse = new Fuse(helpMessagesTitles.map(title => ({ title })), fuseOptions);            
                    const scoredResults = fuse.search(typedSoFar).sort((a, b) => a.score - b.score);
                    helpMessagesTitles = scoredResults.map(entry => entry.item.title);
                }
                
                cmd.respond(arrayToAutocorrect(helpMessagesTitles));
                break;
            
            case "subtopic":
                const options = subtopics.filter(subtopic => subtopic.startsWith(typedSoFar));
                cmd.respond(arrayToAutocorrect(options))
                break;

            case "chart":
                const chartOptions = getChartOptions();
                const matching = sortByMatch(chartOptions, typedSoFar);
                cmd.respond(arrayToAutocorrect(matching))
                break
        }
    }

    // Modal submit interactions from creating and editing messages
    else if (cmd.isModalSubmit()) {
        switch(cmd.customId) {
            case "editModal":
            case "createModal":
                const isEditing = cmd.customId == "editModal";

                // Some fields have embeded data, so extract that ( fieldName-data ) 
                const modalFields = cmd.fields.fields.map(field => field.customId);
                const subtopicFieldID = modalFields.filter(field => field.startsWith("S-"))[0];
                const titleFieldID = modalFields.filter(field => field.startsWith("T-"))[0];
                
                const message = cmd.fields.getTextInputValue('Message');
                const title = cmd.fields.getTextInputValue(titleFieldID);
                const subtopic = cmd.fields.getTextInputValue(subtopicFieldID);

                // Embeded data from fields, default to the current values if not specified
                const formerSubtopic = subtopicFieldID.split("-").slice(1).join("-") || subtopic;
                const formerTitle = titleFieldID.split("-").slice(1).join("-") || title;
            
                // Make sure topic exists
                if (!subtopics.includes(subtopic)) {
                    cmd.reply({ content: "That is not a valid subtopic.", ephemeral: true })
                    break;
                }
                
                // Make sure the title does not already exist (unless it's an edit AND it's going into the same file)
                // TODO: cleanup logic when it isn't 11:30 PM lol
                const tilesInNewLocation = getHelpMessageTitlesArray(getFileContent(subtopic));
                if (
                    // If this title already exists where we're trying to put it and we are create a new post
                    (tilesInNewLocation.includes(title) && !isEditing) || 
                    // Or if we're editing, and the subtopic changed
                    (tilesInNewLocation.includes(title) && isEditing && formerSubtopic != subtopic) ||
                    // Or if we're editing, the subtopic did not changed, but the name has (possibly mimicking another entry)
                    (tilesInNewLocation.includes(title) && isEditing && formerSubtopic == subtopic && title != formerTitle)
                ) {
                    cmd.reply({ content: "A Help Message already exists with that title in that location.", ephemeral: true })
                    break;
                }

                // Add / edit message
                if (isEditing) editHelpMessage(subtopic, title, message, formerTitle, formerSubtopic)
                else appendHelpMessage(subtopic, title, message);

                cmd.reply({ content: `${isEditing ? "This" : "Your"} Help Message has been ${isEditing ? "edited" : "added"}, thanks!`, ephemeral: true })
                break;
        }
    }

    // Command interactions
    else {
        switch(cmd.commandName) {
            case "lookup":
                const subtopic = cmd.options.getSubcommand();
                const messageTopic = cmd.options.getString("title");

                // Lookup response to this query
                const reply = getHelpMessageBySubjectTitle(subtopic, messageTopic);
                
                cmd.reply({ content: reply, ephemeral: true });
                break;

            case "flowchart":
                await cmd.deferReply(); // Puppeteer can take a while, this gives us much longer to respond
                var chart = cmd.options.getString("chart");
                const overrideCacheAttempt = cmd.options.getBoolean("override-cache")
                const overrideCache = overrideCacheAttempt && AuthorizedEditors.includes(cmd.user.id);
                const sendHTML = cmd.options.getBoolean("attach-html")

                var [chartPath, error] = await getPathToFlowchart(chart, false, sendHTML, overrideCache);
                if (error) {
                    cmd.followUp({ content: error, ephemeral: true });
                    break
                }

                var response = `Here is the \`${chart}\` chart`;
                // Add message if user tried to flush cache without perms
                if (overrideCacheAttempt != overrideCache) {
                    response += ` - cached was not overridden as you are not authorized to do so`
                }

                let files = [
                    new AttachmentBuilder(chartPath),
                ]
                if (sendHTML) files.push( new AttachmentBuilder(`./Flowcharts/generated.html`) ) // ideally the path would be determined by flowcharter.js, oh well 

                cmd.followUp({
                    content: response, 
                    files: files,
                    ephemeral: false
                });
                break

            case "edit_flowchart":
                if (!AuthorizedEditors.includes(cmd.user.id)) {
                    return cmd.reply({ content: "You are not authorized to use this command", ephemeral: true });
                }
                const fileUpload = cmd.options.getAttachment("file");
                var chart = cmd.options.getString("chart");
                var [chartPath, error] = await getPathToFlowchart(chart, true); // only fetching mermaid path
                if (error) {
                    cmd.reply({ content: error, ephemeral: true });
                    break
                }

                // If we have the file, we use it - otherwise, send the user the current file
                if (fileUpload) {
                    downloadFile(fileUpload.url, chartPath)
                    cmd.reply({
                        content: `The chart has been updated`, 
                        ephemeral: true
                    });
                } else {
                    let mermaidContent = fs.readFileSync(chartPath);
                    cmd.reply({
                        content: 
                            `Here is the current \`${chart}\` flowchart` +
                            `## Flowchart must follow these rules:` +
                            `1. Every "Question" has either:` +
                            `   a. Named lines as options, going to the next questions` +
                            `   b. Unnamed lines going to the next options, which each have a single link to the next question` +
                            `2. All nodes must have IDs`,
                        files: [ 
                            new AttachmentBuilder(Buffer.from(mermaidContent), { name: `${chart}.txt` })
                        ],
                        ephemeral: true
                    });
                }
                break;

            case "edit": //both edit and create open basically the same modals
            case "create":
                const isEditing = cmd.commandName == "edit";

                // Check authorization
                if (!AuthorizedEditors.includes(cmd.member?.user?.id)) {
                    cmd.reply({ content: `You are not authorized to ${isEditing ? "edit" : "create"} messages.`, ephemeral: true })
                    break;
                }

                // Check if it's a valid topic
                const createSubtopic = cmd.options.getString("subtopic");
                if (!subtopics.includes(createSubtopic)) {
                    cmd.reply({ content: "That is not a valid subtopic.", ephemeral: true })
                    break;
                }

                // Create a modal
                const modal = new ModalBuilder()
                    .setCustomId(isEditing ? "editModal" : "createModal")
                    .setTitle(`"${isEditing ? "Edit a" : "Create a new"} Help Message"`);
                
                const title = new TextInputBuilder()
                    .setCustomId("T-") // we embed more data here later if editing
                    .setLabel("Title")
                    .setPlaceholder("Turret Remove Guide Card")
                    .setMaxLength(49)
                    .setStyle(TextInputStyle.Short);

                const category = new TextInputBuilder()
                    .setCustomId("S-"+createSubtopic) // We embed the subtopic in the ID in case it's changed so we can know which file the message came from (if moving from one stopic to another)
                    .setLabel("Subtopic")
                    .setPlaceholder("ide")
                    .setValue(createSubtopic)
                    .setStyle(TextInputStyle.Short);

                const message = new TextInputBuilder()
                    .setCustomId("Message")
                    .setLabel("Message")
                    .setPlaceholder("## You can use *Markdown*")
                    .setStyle(TextInputStyle.Paragraph);

                // If we're editing, lookup and set the values of each field so they don't have to be reentered to edit
                if (isEditing) {
                    // Fill title field
                    const titleToEdit = cmd.options.getString("title").match(/[\s\w\/&\(\)]/g).join(""); // Filter out special characters before using as custom ID - TODO this would be better placed in helpFileParse to keep regexes togetehr
                    title.setValue(titleToEdit);
                    title.setCustomId("T-"+titleToEdit)

                    // Confirm it is a valid title
                    if (!getHelpMessageTitlesArray(getFileContent(createSubtopic)).includes(titleToEdit)) {
                        cmd.reply({ content: "No Help Message exists with that title.", ephemeral: true })
                        break;
                    }

                    // Fill in message feild with current version
                    const messageContent = getHelpMessageBySubjectTitle(createSubtopic, titleToEdit);
                    message.setValue(messageContent);
                }
        
                const categoryRow = new ActionRowBuilder().addComponents(category);
                const titleRow = new ActionRowBuilder().addComponents(title);
                const messageRow = new ActionRowBuilder().addComponents(message);
                modal.addComponents(categoryRow, titleRow, messageRow);
        
                await cmd.showModal(modal);
                break;

            case "mark-robot":
                // Mark Robot takes a few seconds so we can't reply right away
                await cmd.deferReply({ ephemeral: true });

                const userID = cmd.member.user.id;

                const robotMessage = cmd.options.getString("message");
                const shouldClear = cmd.options.getBoolean("clear") || false;

                // Create a Robot instance for this user if they don't have one already
                if (shouldClear || !markRobotInstances[userID]) {
                    markRobotInstances[userID] = new MarkRobot();
                }

                // Get response from Mark Robot
                var response = await markRobotInstances[userID].message(robotMessage);

                // cmd.reply({ content: response, ephemeral: true });
                cmd.editReply(response);
                break;
        }
    }
})



// Other listeners
client.once("ready",async ()=>{
    console.log("Ready");
})


// Error handling (async crashes in discord.js threads can still crash it)
function handleException(e) {
    console.log(e);
}
process.on('unhandledRejection', handleException);
process.on('unhandledException', handleException);

// Start
client.login(process.env.token);
