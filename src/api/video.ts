import { RevError } from '../rev-error';
import type { RevClient } from '../rev-client';
import { Video, Rev, Admin, Transcription } from '../types/index';
import { SearchRequest } from '../utils/request-utils';
import { videoReportAPI } from './video-report-request';
import { videoDownloadAPI } from './video-download';
import { RateLimitEnum, sleep } from '../utils';
import { mergeHeaders } from '../utils/merge-headers';
import { videoExternalAccessAPI } from './video-external-access';

/** @ignore */
type VideoSearchDetailedItem = Video.SearchHit & (Video.Details | { error?: Error });

/**
 * @ignore
 */
export type API = ReturnType<typeof videoAPIFactory>;

/**
 * Video API methods
 * @category Videos
 * @group API
 * @see [Video API Docs](https://revdocs.vbrick.com/reference/searchvideo)
 */
export interface VideoAPI extends API {};

/** @ignore */
export default function videoAPIFactory(rev: RevClient) {
    /** get list of comments on a video
     *
     * set `showAll` param to `true` to include un-redacted values of comments (admin only)
     */
    function comments(videoId: string): Promise<Video.Comment[]>;
    function comments(videoId: string, showAll: true): Promise<Video.Comment.Unredacted[]>;
    async function comments(videoId: string, showAll: boolean = false): Promise<Video.Comment[] | Video.Comment.Unredacted[]> {
        const response = await rev.get<Video.Comment.ListResponse>(`/api/v2/videos/${videoId}/comments`, showAll ? { showAll: 'true' } : undefined);
        return response.comments;
    }

    const videoAPI = {
        /**
         * This is an example of using the video Patch API to only update a single field
         * @param videoId
         * @param title
         */
        async setTitle(videoId: string, title: string) {
            const payload = [{ op: 'add', path: '/Title', value: title }];
            await rev.session.queueRequest(RateLimitEnum.UpdateVideoMetadata);
            await rev.patch(`/api/v2/videos/${videoId}`, payload);
        },
        /**
         * Use the Patch API to update a single Custom Field.
         * @param videoId - id of video to update
         * @param customField - the custom field object (with id and value)
         */
        async setCustomField(videoId: string, customField: Pick<Admin.CustomField, 'id' | 'value'>) {
            // LEGACY behavior, only relevant for Rev < 7.48
            // const payload = [
            //     { op: 'remove', path: '/customFields', value: customField.id },
            //     { op: 'add', path: '/customFields/-', value: customField }
            // ];
            const payload = [{
                op: 'replace',
                path: '/CustomFields',
                value: [customField]
            }];
            await rev.session.queueRequest(RateLimitEnum.UpdateVideoMetadata);
            await rev.patch(`/api/v2/videos/${videoId}`, payload);
        },
        async delete(videoId: string, options?: Rev.RequestOptions): Promise<void> {
            await rev.session.queueRequest(RateLimitEnum.UpdateVideoMetadata);
            await rev.delete(`/api/v2/videos/${videoId}`, undefined, options);
            // TIP: If delete returns a 401 then video has likely already been deleted
        },
        /**
         * get processing status of a video
         * @see [API Docs](https://revdocs.vbrick.com/reference/getvideostatus)
         */
        async status(videoId: string, options?: Rev.RequestOptions): Promise<Video.StatusResponse> {
            return rev.get(`/api/v2/videos/${videoId}/status`, undefined, options);
        },
        /**
         * get details of a video
         * @see [API Docs](https://revdocs.vbrick.com/reference/getvideosdetails)
         * @param videoId
         * @param options
         * @returns
         */
        async details(videoId: string, options?: Rev.RequestOptions): Promise<Video.Details> {
            await rev.session.queueRequest(RateLimitEnum.GetVideoDetails);
            return rev.get(`/api/v2/videos/${videoId}/details`, undefined, options);
        },
        async update(videoId: string, metadata: Video.UpdateRequest, options?: Rev.RequestOptions): Promise<void> {
            await rev.session.queueRequest(RateLimitEnum.UpdateVideoMetadata);
            await rev.put(`/api/v2/videos/${videoId}`, metadata, options);
        },
        comments,
        async chapters(videoId: string, options?: Rev.RequestOptions): Promise<Video.Chapter[]> {
            try {
                const {chapters} = await rev.get<{chapters: Video.Chapter[]}>(`/api/v2/videos/${videoId}/chapters`, undefined, options);
                return chapters;
            } catch (err) {
                // if no chapters then this api returns a 400 response
                if (err instanceof RevError && err.code === "NoVideoChapters") {
                    return [];
                }
                throw err;
            }
        },
        async supplementalFiles(videoId: string, options?: Rev.RequestOptions): Promise<Video.SupplementalFile[]> {
            const {supplementalFiles} = await rev.get(`/api/v2/videos/${videoId}/supplemental-files`, undefined, options);
            return supplementalFiles;
        },
        // async deleteSupplementalFiles(videoId: string, fileId: string | string[]): Promise<void> {
        //     const fileIds = Array.isArray(fileId)
        //         ? fileId.join(',')
        //         : fileId
        //     await rev.delete(`/api/v2/videos/${videoId}/supplemental-files`, { fileIds });
        // },
        async thumbnailConfiguration(videoId: string, options?: Rev.RequestOptions): Promise<Video.ThumbnailConfiguration> {
            const {thumbnailCfg} = await rev.get(`/api/v2/videos/${videoId}/thumbnail-config`, undefined, options);
            return thumbnailCfg;
        },
        async transcriptions(videoId: string, options?: Rev.RequestOptions): Promise<Transcription[]> {
            const {transcriptionFiles} = await rev.get(`/api/v2/videos/${videoId}/transcription-files`, undefined, options);
            return transcriptionFiles;
        },
        get upload() {
            return rev.upload.video;
        },
        get replace() {
            return rev.upload.replaceVideo;
        },
        async migrate(videoId: string, options: Video.MigrateRequest, requestOptions?: Rev.RequestOptions) {
            await rev.session.queueRequest(RateLimitEnum.UpdateVideoMetadata);
            await rev.put(`/api/v2/videos/${videoId}/migration`, options, requestOptions);
        },
        /**
         * search for videos, return as one big list. leave blank to get all videos in the account
         */
        search(query: Video.SearchOptions = { }, options: Rev.SearchOptions<Video.SearchHit> = { }): Rev.ISearchRequest<Video.SearchHit> {
            const searchDefinition: Rev.SearchDefinition<Video.SearchHit> = {
                endpoint: '/api/v2/videos/search',
                totalKey: 'totalVideos',
                hitsKey: 'videos',
                async request(endpoint, query, options) {
                    await rev.session.queueRequest(RateLimitEnum.SearchVideos);
                    return rev.get(endpoint, query, options);
                }
            };
            const request = new SearchRequest<Video.SearchHit>(rev, searchDefinition, query, options);
            return request;
        },
        /**
         * Example of using the video search API to search for videos, then getting
         * the details of each video
         * @deprecated This method can cause timeouts if iterating through a very
         *             large number of results, as the search scroll cursor has a
         *             timeout of ~5 minutes. Consider getting all search results
         *             first, then getting details
         * @param query
         * @param options
         */
        searchDetailed(
            query: Video.SearchOptions = { },
            options: Rev.SearchOptions<VideoSearchDetailedItem> = { }
        ): Rev.ISearchRequest<VideoSearchDetailedItem> {
            const searchDefinition = {
                endpoint: '/api/v2/videos/search',
                totalKey: 'totalVideos',
                hitsKey: 'videos',
                transform: async (videos: Video.SearchHit[]) => {
                    const result: Array<Video.SearchHit & (Video.Details & { error?: Error; })> = [];
                    for (let rawVideo of videos) {
                        const out: Video.SearchHit & (Video.Details & { error?: Error; }) = rawVideo as any;
                        try {
                            const details = await videoAPI.details(rawVideo.id);
                            Object.assign(out, details);
                        } catch (error: any) {
                            out.error = error;
                        }
                        result.push(out);
                    }
                    return result;
                }
            };
            const request = new SearchRequest<Video.SearchHit>(rev, searchDefinition, query, options);
            return request;
        },
        async playbackInfo(videoId: string): Promise<Video.Playback> {
            const { video } = await rev.get(`/api/v2/videos/${videoId}/playback-url`);
            return video;
        },
        async playbackUrls(videoId: string, {ip, userAgent}: Video.PlaybackUrlsRequest = {}, options?: Rev.RequestOptions): Promise<Video.PlaybackUrlsResponse> {
            const query = ip ? { ip } : undefined;

            const opts: Rev.RequestOptions = {
                ...options,
                ...userAgent && {
                    headers: mergeHeaders(options?.headers, { 'User-Agent': userAgent })
                },
                responseType: 'json'
            };

            return rev.get(`/api/v2/videos/${videoId}/playback-urls`, query, opts);
        },
        ...videoDownloadAPI(rev),
        ...videoReportAPI(rev),
        ...videoExternalAccessAPI(rev),
        listDeleted(query: Video.RemovedVideosQuery = {}, options: Rev.SearchOptions<Video.RemovedVideoItem> = {}): Rev.ISearchRequest<Video.RemovedVideoItem> {
            const searchDefinition: Rev.SearchDefinition<Video.RemovedVideoItem> = {
                endpoint: '/api/v2/videos/deleted',
                totalKey: 'totalVideos',
                hitsKey: 'deletedVideos',
                async request(endpoint, query, options) {
                    await rev.session.queueRequest(RateLimitEnum.SearchVideos);
                    return rev.get(endpoint, query, options);
                }
            };
            const request = new SearchRequest<Video.RemovedVideoItem>(rev, searchDefinition, query, options);
            return request;
        },
        /**
         * @deprecated Use edit() API instead
         */
        async trim(videoId: string, removedSegments: Array<{ start: string, end: string }>) {
            await rev.session.queueRequest(RateLimitEnum.UploadVideo);
            return rev.post(`/api/v2/videos/${videoId}/trim`, removedSegments);
        },
        async convertDualStreamToSwitched(videoId: string) {
            await rev.session.queueRequest(RateLimitEnum.UpdateVideoMetadata);
            return rev.put<void>(`/api/v2/videos/${videoId}/convert-dual-streams-to-switched-stream`);
        },
        async edit(videoId: string, keepRanges: Video.ClipRequest[], options?: Rev.RequestOptions) {
            await rev.session.queueRequest(RateLimitEnum.UploadVideo);
            return rev.post(`/api/v2/videos/${videoId}/edit`, keepRanges, options);
        },
        async patch(videoId: string, operations: Rev.PatchOperation[], options?: Rev.RequestOptions) {
            await rev.session.queueRequest(RateLimitEnum.UpdateVideoMetadata);
            await rev.patch(`/api/v2/videos/${videoId}`, operations, options);
        },
        async generateMetadata(videoId: string, fields: Video.MetadataGenerationField[] = ["all"], options?: Rev.RequestOptions) {
            await rev.session.queueRequest(RateLimitEnum.UpdateVideoMetadata);
            await rev.put(`/api/v2/videos/${videoId}/generate-metadata`, { metadataGenerationFields: fields }, options);
        },
        async generateMetadataStatus(videoId: string, options?: Rev.RequestOptions): Promise<Video.MetadataGenerationStatus> {
            const {description} = await rev.get(`/api/v2/videos/${videoId}/metadata-generation-status`, undefined, {...options, responseType: 'json'});
            return description.status;
        },
        async transcribe(videoId: string, language: Transcription.SupportedLanguage | Transcription.Request, options?: Rev.RequestOptions): Promise<Transcription.Status> {
            const payload = typeof language === 'string' ? { language } : language;
            return rev.post(`/api/v2/videos/${videoId}/transcription`, payload, {...options, responseType: 'json'})
        },
        async transcriptionStatus(videoId: string, transcriptionId: string, options?: Rev.RequestOptions): Promise<Transcription.Status> {
            return rev.get(`/api/v2/videos/${videoId}/transcriptions/${transcriptionId}/status`, undefined, {...options, responseType: 'json'});
        },
        async translate(videoId: string, source: Transcription.TranslateSource, target: Transcription.SupportedLanguage | Transcription.SupportedLanguage[], options?: Rev.RequestOptions): Promise<Transcription.TranslateResult> {
            const payload = {
                sourceLanguage: source,
                targetLanguages: typeof target === 'string' ? [target] : target
            };
            return rev.post(`/api/v2/videos/${videoId}/translations`, payload, {...options, responseType: 'json'});
        },
        async getTranslationStatus(videoId: string, language: Transcription.SupportedLanguage, options?: Rev.RequestOptions): Promise<Transcription.StatusEnum> {
            const {status} = await rev.get(`/api/v2/videos/${videoId}/translations/${language}/status`, undefined, {...options, responseType: 'json'});
            return status;
        },
        async deleteTranscription(videoId: string, language?: Transcription.SupportedLanguage | Transcription.SupportedLanguage[], options?: Rev.RequestOptions): Promise<void> {
            const locale = Array.isArray(language) ? language.map(s => s.trim()).join(',') : language;
            await rev.delete(`/api/v2/videos/${videoId}`, locale ? {locale} : undefined, options);
        },
        /**
         * Helper - update the audio language for a video. If index isn't specified then update the default language
         * @param video - videoId or video details (from video.details api call)
         * @param language - language to use, for example 'en'
         * @param trackIndex - index of audio track - if not supplied then update default or first index
         * @param options
         */
        async setAudioLanguage(video: string | Video.Details, language: Transcription.SupportedLanguage, trackIndex?: number, options?: Rev.RequestOptions): Promise<void> {
            const {id, audioTracks = []} = typeof video === 'string' ? { id: video } : video;
            let index = trackIndex ?? audioTracks.findIndex(t => t.isDefault === true) ?? 0;
            const op: Rev.PatchOperation = {
                op: 'replace',
                path: `/audioTracks/${index}`,
                value: { track: index, languageId: language }
            };
            await videoAPI.patch(id, [op], options);
        },
        /**
         * Helper - wait for video transcode to complete.
         * This doesn't indicate that a video is playable, rather that all transcoding jobs are complete
         * @param videoId
         * @param options
         */
        async waitTranscode(videoId: string, options: Video.WaitTranscodeOptions = {}, requestOptions?: Rev.RequestOptions): Promise<Video.StatusResponse> {
            const {
                pollIntervalSeconds = 30,
                timeoutMinutes = 240,
                signal,
                ignorePlaybackWhileTranscoding = true,
                onProgress,
                onError = (error: Error) => { throw error; }
            } = options;

            const ONE_MINUTE = 1000 * 60;
            const timeoutDate = (Date.now() + (timeoutMinutes * ONE_MINUTE) || Infinity);
            // sanity check: ensure at least 5 seconds between calls
            const pollInterval = Math.max((pollIntervalSeconds || 30) * 1000, 5000);
            // set as failed initially in case no error thrown but times out
            let statusResponse = {status: 'UploadFailed'} as Video.StatusResponse;
            while (Date.now() < timeoutDate && !signal?.aborted) {
                // call video status API
                try {
                    statusResponse = await videoAPI.status(videoId, options);
                    let {
                        isProcessing,
                        overallProgress = 0,
                        status
                    } = statusResponse;

                    // status may be Ready initially even though about to go to Processing state
                    if (ignorePlaybackWhileTranscoding && status === 'Ready' && isProcessing) {
                        status = 'Processing';
                    }

                    // force failed processing as finished
                    if (status === 'ProcessingFailed') {
                        overallProgress = 1;
                        isProcessing = false;
                    }
                    // override API values as per above
                    Object.assign(statusResponse, { status, overallProgress, isProcessing });

                    onProgress?.(statusResponse);

                    // isProcessing is initially false, so wait till overallProgress changes to complete
                    if (overallProgress === 1 && !isProcessing) {
                        // finished, break out of loop
                        break;
                    }
                } catch (error) {
                    // by default will throw error
                    await Promise.resolve(onError(error as Error));
                }

                await sleep(pollInterval, signal);
            }
            return statusResponse;
        }
    };
    return videoAPI;
}
