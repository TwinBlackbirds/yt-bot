// This bot was inspired by a YouTube video I saw a couple months ago.
// It was titled something along the lines of 'How many videos does it take before YouTube will recommend an alt-right video?'
// I thought the experiment was poorly done and somewhat biased so I decided to create my own version.
// This webcrawler bot serves as that version.
// I will most likely make a video about this once the project is complete, reporting my findings.

/*
   I plan to use the following technologies:
   JavaScript
   Puppeteer
   Node.js
   R & R studio (for data analysis)
*/

// TODO: VPN/proxy functionality
// TODO: create documentation for command line arguments

import puppeteer, {Browser, LaunchOptions, Viewport} from 'puppeteer';
import 'puppeteer-extra';
import 'puppeteer-extra-plugin-stealth';
import commandLineArgs from 'command-line-args';
import VideoDetails from "./Models/VideoDetails";
import CSVPayload from "./Models/CSVPayload";
import Groq from 'groq-sdk';
import {ChatCompletion} from "groq-sdk/resources/chat/completions";

// global groq client
const client = new Groq({
    // apiKey: process.env['GROQ_API_KEY'], // having issues with env var being recognized
});

// example of using the groq api
async function ask_groq(message: string): Promise<ChatCompletion> {
    return client.chat.completions.create({
        messages: [{ role: 'user', content: message }],
        model: 'llama3-8b-8192',
    });
    // .choices[0].message.content to access text content
}


async function sleep(s: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, s * 1000));
}

// cli arg parsing (global)
let valid_args = [
    {name: 'headless', alias: 'h', type: Boolean},
    {name: 'help', alias: '?', type: Boolean},
    {name: 'start-mode', alias: 's', type: String},
    {name: 'run-mode', alias: 'r', type: String},
    {name: 'amount', alias: 'a', type: String},
    {name: 'sentiment', alias: 't', type: String}
];
let opts = commandLineArgs(valid_args);

// help dialog
// DO NOT CALL AFTER INSTANTIATING BROWSER CONTEXT UNLESS YOU CLOSE IT MANUALLY
function print_help_and_exit(): void {
    console.log("----- help ------");
    console.log("usage: node index.js [options]");
    console.log("options:");
    console.log("  -h, --headless  run in headless mode");
    console.log("  -?, --help      print this help message");
    console.log("  -s, --start-mode  start mode (default: homepage)");
    console.log("  -r, --run-mode  run mode (default: first)");
    console.log("  -a, --amount  run amount (default: unlimited)");
    console.log("  -t, --sentiment  sentiment (default: none)");
    process.exit(0);
}

// pull the data from the page and create a VideoDetails class
function gather_video_details(): VideoDetails {
    return new VideoDetails();
}

function get_next_url(): string {
    return "";
}

// sanitize input to prevent delimiter issues (`)
function save_data_to_csv(): void {

}

// using AI, summarize the video for categorization later
function detect_video_topic(video_details: VideoDetails): CSVPayload {
    return new CSVPayload();
}

async function run_bot(browser: Browser): Promise<void> {
    let tab = await browser.newPage();
    await tab.goto('https://www.youtube.com/');
    await tab.waitForSelector('div[id="content"');
    let no_feed = await tab.$("div[id='content'] > [contents-location='FEED_NUDGE_CONTENTS_LOCATION_UNKNOWN']");
    while (no_feed != null) { // we do not have a feed ('search to get started' dialog)
        let shorts_button = await tab.waitForSelector("ytd-guide-entry-renderer > a[id='endpoint'][title='Shorts']");
        await shorts_button.click();
        await tab.waitForNavigation();
        await sleep(3);
        await tab.goto('https://www.youtube.com/');
        await tab.waitForSelector('div[id="content"');
        no_feed = await tab.$("div[id='content'] > [contents-location='FEED_NUDGE_CONTENTS_LOCATION_UNKNOWN']");
    }
    let cond = true;
    let amount = 0;
    if (opts.amount !== 'unlimited') {
        amount = parseInt(opts.amount);
        cond = false;
    }
    // watch video and nav endlessly (or if n is set, n times)
    while (cond || amount > 0) {
        let video_details = gather_video_details();
        let csv_payload = detect_video_topic(video_details);
        save_data_to_csv();
        let url = get_next_url();
        await tab.goto(url);
        if (amount > 0) {amount--;}
    }
}

// main
async function main() : Promise<void> {
    if (opts.help) { print_help_and_exit(); }
    let headless: boolean  = opts.headless || false;
    // setup browser ctx
    let vp: Viewport = {width: 1920, height: 1080};
    let launch_options: LaunchOptions = {headless: headless, defaultViewport: vp}
    let browser: Browser = await puppeteer.launch(launch_options);

    try {
        await run_bot(browser);
    } finally {
        // ensure browser ctx is not left hanging after our node.js program closes
        await browser.close();
    }
}

main().then(() => console.log("commands executed"));
