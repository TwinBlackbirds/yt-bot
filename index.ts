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

import {Browser, ElementHandle, LaunchOptions, Page, TimeoutError, Viewport} from 'puppeteer';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import commandLineArgs from 'command-line-args';
import VideoDetails from "./Models/VideoDetails";
import CSVPayload from "./Models/CSVPayload";
import Groq from 'groq-sdk';
import {ChatCompletion} from "groq-sdk/resources/chat/completions";
import * as fs from "node:fs";

const SAVE_LOC: string = get_save_loc();

// stealth plugin
puppeteer.use(StealthPlugin())

// global groq client
const client = new Groq({
    // apiKey: process.env['GROQ_API_KEY'], // having issues with env var being recognized
});

// example of using the groq api
async function ask_groq(message: string): Promise<ChatCompletion> {
    return client.chat.completions.create({
        messages: [{role: 'system', content: 'Respond only in one word.'}, { role: 'user', content: message }],
        model: 'llama3-8b-8192',
    });
    // .choices[0].message.content to access text content
}

function get_save_loc(): string {
    let i = 1;
    if (!fs.existsSync(`./csv`)) {
        fs.mkdirSync(`./csv`);
    }
    while (fs.existsSync(`./csv/${i}.csv`)) {
        i++;
    }
    return `./csv/${i}.csv`;
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
async function gather_video_details(tab: Page): Promise<VideoDetails> {

    console.log("gathering video details...");
    let skip_ad: ElementHandle | null = null;
    try {
        skip_ad = await tab.waitForSelector("button[id*='skip-button']", {timeout: 5000});
    } catch {
        skip_ad = null;
    }
    while (skip_ad != null) {
        await sleep(5); // wait for button to be clickable
        console.log("skipping ad...");
        await skip_ad.click();
        try {
            skip_ad = await tab.waitForSelector("button[id*='skip-button']", {timeout: 10000});
        } catch {
            break;
        }
    }
    let video_details = new VideoDetails();

    let title = await tab.waitForSelector("div[id='title'] yt-formatted-string[title]");
    let title_text = await (await title.getProperty("textContent")).jsonValue();

    let meta_title = await tab.$("meta[name='title']");
    let meta_title_text = await (await meta_title.getProperty("content")).jsonValue();

    while (title_text.trim() != meta_title_text.trim()) {
        console.log("Invalid metadata! Attempting to reload...")

        title = await tab.waitForSelector("div[id='title'] yt-formatted-string[title]");
        title_text = await (await title.getProperty("textContent")).jsonValue();

        meta_title = await tab.$("meta[name='title']");
        meta_title_text = await (await meta_title.getProperty("content")).jsonValue();
        await tab.reload();
    }

    let url = tab.url();

    // let likes = (await tab.$$("like-button-view-model div[class*='text-content']"))[0]; // in formatted with K, M, etc.
    // let likes_text = await (await likes.getProperty("textContent")).jsonValue();

    let comments = await tab.$("ytd-comments-header-renderer yt-formatted-string > span");
    let x: number = 1;
    while (comments == null) {
        if (x % 5 == 0 && x != 0) {
            console.log(`Still can't find the comment count, reloading the page... (${x})`);
            await tab.reload();
        }
        console.log(`comment count not found, scrolling in an attempt to load it... (${x})`);
        for (let i = 0; i < x; i++) {
            await tab.evaluate(() => (this.window.scrollBy(0, 1080)))
            await sleep(3);
        }
        await tab.evaluate(() => (this.window.scrollTo(0, 0)))
        try {
            comments = await tab.waitForSelector("ytd-comments-header-renderer yt-formatted-string > span", {
            timeout: 5000,
            });
        } catch {
            comments = null;
        }

        x++;
    }
    console.log(`comment count not found, scrolling in an attempt to load it... (${x})`);
    
    let comments_text = (await (await comments.getProperty("textContent")).jsonValue()).replaceAll(",", "");

    let duration = await tab.$("span[class*='ytp-time-wrapper'] > .ytp-time-duration");
    let duration_text = await (await duration.getProperty("textContent")).jsonValue();

    let thumbnail = await tab.$("link[rel='image_src']"); // get href
    let thumbnail_url = await (await thumbnail.getProperty("href")).jsonValue();

    let channel_name = await tab.$("div[id='owner'] yt-formatted-string[title]");
    let channel_name_text = await (await channel_name.getProperty("textContent")).jsonValue();

    let channel_sub_count = await tab.$("yt-formatted-string#owner-sub-count");
    let channel_sub_count_text = await (await channel_sub_count.getProperty("textContent")).jsonValue();

    let channel_url = await tab.$("div[id='owner'] a[class*='yt-formatted-string']");
    let channel_url_text = await (await channel_url.getProperty("href")).jsonValue();

    let date_and_views_info = await tab.$("ytd-watch-info-text div#tooltip");
    let date_and_views_text_arr = (await (await date_and_views_info.getProperty("textContent")).jsonValue()).split("•");
    let views_text = date_and_views_text_arr[0].trim().replaceAll(",", "").replaceAll(" views", "");
    let date_uploaded_text = date_and_views_text_arr[1].trim();

    let date_gathered_text = Date.now().toString();

    let description_snippet = await tab.$("meta[name='description']");
    let description_text = await (await description_snippet.getProperty("content")).jsonValue();

    let tags = await tab.$("meta[name='keywords']");
    let tags_text = await (await tags.getProperty("content")).jsonValue();

    video_details.title = title_text;
    video_details.url = url.split("&")[0];
    video_details.views = views_text;
    video_details.likes = ""; // having issues with this since it is a bunch of "scrolling number renderers"
    video_details.comments = comments_text;
    video_details.duration = duration_text;
    video_details.thumbnail = thumbnail_url;
    video_details.channel = channel_name_text;
    video_details.channel_sub_count = channel_sub_count_text;
    video_details.channel_url = channel_url_text;
    video_details.date_uploaded = date_uploaded_text;
    video_details.date_collected = date_gathered_text;
    video_details.description = description_text;
    video_details.tags = tags_text;

    return video_details;
}

async function get_starting_video(tab: Page): Promise<string> {
    console.log("getting starting url...");
    // depends on the run mode, but for now it will just be the first video in homepage
    let all_vids = await tab.$$("a#video-title-link");
    return await (await all_vids[0].getProperty("href")).jsonValue();
}

async function get_next_url(tab: Page, seen_videos: string[]): Promise<string> {
    console.log("getting next url...");
    // depends on the run mode, but for now it will just be the first video in the sidebar
    let all_vids = await tab.$$("#secondary .details a");
    let first_valid_video_idx = 0; // assume the first video is valid
    let href = await (await all_vids[0].getProperty("href")).jsonValue();
    while (true) { // check validity
        if (
        href.indexOf('adservice') == -1 && // not an ad
        href.indexOf('watch?') > -1 &&  // is a video
        !seen_videos.includes(href)) { // hasn't been seen yet
            break;
        } // otherwise try next URL
        first_valid_video_idx++;
        // will give an out-of-bounds exception if we can't find a valid video (BAD STATE REGARDLESS!)
        href = await (await all_vids[first_valid_video_idx].getProperty("href")).jsonValue();
    }
    return href;
}

// sanitize input to prevent delimiter issues (`)
async function save_data_to_csv(payload: CSVPayload): Promise<void> {
    console.log("saving data to csv...");

    let csv_header: string = "";
    for (let key in payload) {
        csv_header += `${key}`;
        if (key !== Object.keys(payload)[Object.keys(payload).length - 1]) {
            csv_header += "`";
        }
    }
    csv_header += "\n";
    if (!fs.existsSync(SAVE_LOC)) {
        fs.writeFileSync(SAVE_LOC, csv_header);
    }
    let csv_string: string = "";
    for (let key in payload) {
        let value = payload[key];
        let sanitized_value: string = value.replaceAll("`", "'");
        csv_string += `${sanitized_value}`;
        if (key !== Object.keys(payload)[Object.keys(payload).length - 1]) {
            csv_string += "`"
        }
    }
    csv_string += "\n";
    fs.appendFileSync(SAVE_LOC, csv_string);
}

// using AI, summarize the video for categorization later
async function detect_video_topic(video_details: VideoDetails): Promise<CSVPayload> {
    console.log("detecting video topic...");
    let prompt = "Please determine a very general topic for the following video: "
    for (let key in video_details) {
        prompt += `${key}: ${video_details[key]}\n`;
    }
    // console.log(prompt);
    let ai_summary = await ask_groq(prompt);
    let message = ai_summary.choices[0].message.content;
    console.log(`got topic from ai: '${message}'`);
    return new CSVPayload(video_details, message);
}

async function watch_video(video_details: VideoDetails): Promise<void> {
    let dur_split = video_details.duration.split(":");
    let minutes = "0";
    if (dur_split.length > 3) { // if video is over a day
        minutes = dur_split[2];
    }
    else if (dur_split.length > 2) { // if video is over an hour
        minutes = dur_split[1];
    } else {
        minutes = dur_split[0];
    }
    let time_to_watch_m = Math.floor(Math.random() * (parseInt(minutes))) * 60;
    let time_to_watch_s = Math.floor(Math.random() * 60);
    let time_to_watch = time_to_watch_m + time_to_watch_s;
    console.log(`watching video for ${time_to_watch_m/60}m${time_to_watch_s}s (video is ${video_details.duration} long)`);
    await sleep(time_to_watch);
}

async function run_bot(browser: Browser): Promise<void> {
    let tab = await browser.newPage();
    await tab.goto('https://www.youtube.com/');
    await tab.waitForSelector('div[id="content"');
    let no_feed = await tab.$("div[id='content'] > [contents-location='FEED_NUDGE_CONTENTS_LOCATION_UNKNOWN']");
    no_feed != null ? console.log("attempting to get a recommended feed...") : console.log("feed found!");
    while (no_feed != null) { // we do not have a feed ('search to get started' dialog)
        console.log("still attempting to get a recommended feed...");
        let shorts_button = await tab.waitForSelector("ytd-guide-entry-renderer > a[id='endpoint'][title='Shorts']");
        await shorts_button.click();
        await tab.waitForSelector('video');
        await sleep(3);
        await tab.goto('https://www.youtube.com/');
        try {
            no_feed = await tab.waitForSelector("div[id='content'] > [contents-location='FEED_NUDGE_CONTENTS_LOCATION_UNKNOWN']", {timeout: 10000});
        } catch (e) {
            if (e instanceof TimeoutError) {
                console.log("feed found!");
                break;
            }
            else throw e;
        }
    }
    let cond = true;
    let amount = 0;
    if (opts.amount !== 'unlimited' && opts.amount != null) {
        amount = parseInt(opts.amount);
        cond = false;
    }
    let url = await get_starting_video(tab);

    // so we can skip duplicate videos
    let seen_videos: string[] = [];

    // watch video and nav endlessly (or if n is set, n times)
    while (cond || amount > 0) {
        await tab.goto(url);
        await tab.waitForSelector("video");

        // detect live stream
        let live_video = await tab.$(".ytp-clip-watch-full-video-button");
        let is_live = await live_video.getProperty("textContent");
        if (!(await is_live.jsonValue()).includes("video")) {
            console.log("video is live, skipping & blacklisting url...");
            seen_videos.push(tab.url().split("&")[0]);
            await sleep(3);
            url = await get_next_url(tab, seen_videos);
            continue;
        }
        await sleep(3);
        // get video details
        let video_details = await gather_video_details(tab);
        seen_videos.push(video_details.url);
        console.log(video_details);
        // await watch_video(video_details);
        await sleep(10);

        // log the video details
        let csv_payload = await detect_video_topic(video_details);
        await save_data_to_csv(csv_payload);
        // move on
        url = await get_next_url(tab, seen_videos);
        if (amount > 0) {amount--;}
    }
    // notes: crawling videos works, gathering details works, skipping ads works
    // getting a homepage suggestion feed works,
    // put data into csv text, save to file works
    // scaffolding saved data into folders works
    // TODO: statistic analysis, edge case error handling
    // TODO: limit to 30m watching time
}

// main
async function main() : Promise<void> {
    if (opts.help) { print_help_and_exit(); }
    let headless: boolean  = opts.headless || true;
    // setup browser ctx
    let vp: Viewport = {width: 1920, height: 1080};
    let launch_options: LaunchOptions = {headless: headless, defaultViewport: vp, args: ['--mute-audio']}
    let browser: Browser = await puppeteer.launch(launch_options);

    try {
        await run_bot(browser);
    } finally {
        // ensure browser ctx is not left hanging after our node.js program closes
        console.log("closing browser...");
        try {
            await browser.close();
            console.log("browser closed");
        } catch {
            console.log("browser already closed");
        }
    }
}

main().then(() => console.log("commands executed"));
