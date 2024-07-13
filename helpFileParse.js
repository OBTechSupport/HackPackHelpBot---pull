// 
// This file gets the content every single time it is called.
// If it is ever used more heavily, the file content should be cached. 
//

const fs = require("fs");

function grabFromStringToString(string="", start=null, end=null, inclusive=false) {
    if (start) string = string.substring(string.indexOf(start) + (inclusive ? 0 : start.length)) // cut everything before start
    if (end)   string = string.substring(0, string.indexOf(end) - (inclusive ? end.length : 0)) // cut everything after end
    string = string.trim();
    return string;
}

function getDescription(fileContent) {
    return fileContent.split("---")?.[0].split("###")?.[1].trim() || "No Description provided";
}

function getHelpMessageTitlesArray(fileContent="") {
    const messages = fileContent.split("---");
    messages.shift(); // First message is just the category description
    const titles = [];
    messages.forEach(message => {
        var title = grabFromStringToString(message, "Title: ", "\n");
        if (title) titles.push(title);
    })
    return titles;
}

function getHelpMessageBySubjectTitle(subject, title) {
    const fileContent = getFileContent(subject);
    const messages = fileContent.split("---");
    messages.shift(); // First message is just the category description
    for (var message of messages) {
        var thisTitle = grabFromStringToString(message, "Title: ", "\n");
        if (thisTitle == title) {
            return grabFromStringToString(message, "Message:");
        }
    }
    return "No content found for this query";
}

function getFileContent(fileName) {
    return fs.readFileSync(`./GeneralTopicStore/${fileName}`).toString();
}


// Export functions
module.exports = {
    getDescription,
    getHelpMessageTitlesArray,
    getHelpMessageBySubjectTitle,
    getFileContent
};
