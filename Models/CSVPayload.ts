import VideoDetails from "./VideoDetails";

export default class CSVPayload extends VideoDetails {
    public ai_determined_topic: string;
    constructor(video_details: VideoDetails, topic: string) {
        super();
        this.title = video_details.title;
        this.url = video_details.url;
        this.views = video_details.views;
        this.likes = video_details.likes;
        this.comments = video_details.comments;
        this.duration = video_details.duration;
        this.thumbnail = video_details.thumbnail;
        this.channel = video_details.channel;
        this.channel_sub_count = video_details.channel_sub_count;
        this.channel_url = video_details.channel_url;
        this.date_uploaded = video_details.date_uploaded;
        this.date_collected = video_details.date_collected;
        this.description = video_details.description;
        this.tags = video_details.tags;
        this.ai_determined_topic = topic;
    }
}