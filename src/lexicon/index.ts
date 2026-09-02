/**
 * GENERATED CODE - DO NOT MODIFY
 */
import {
  XrpcClient,
  type FetchHandler,
  type FetchHandlerOptions,
} from '@atproto/xrpc'
import { schemas } from './lexicons.js'
import { CID } from 'multiformats/cid'
import { type OmitKey, type Un$Typed } from './util.js'
import * as AppAtmobbActorGetActivity from './types/app/atmobb/actor/getActivity.js'
import * as AppAtmobbActorProfile from './types/app/atmobb/actor/profile.js'
import * as AppAtmobbDiscussionCreateReply from './types/app/atmobb/discussion/createReply.js'
import * as AppAtmobbDiscussionCreateThread from './types/app/atmobb/discussion/createThread.js'
import * as AppAtmobbDiscussionGetBoardThreads from './types/app/atmobb/discussion/getBoardThreads.js'
import * as AppAtmobbDiscussionGetLatestThreads from './types/app/atmobb/discussion/getLatestThreads.js'
import * as AppAtmobbDiscussionGetThreadPage from './types/app/atmobb/discussion/getThreadPage.js'
import * as AppAtmobbDiscussionReply from './types/app/atmobb/discussion/reply.js'
import * as AppAtmobbDiscussionThread from './types/app/atmobb/discussion/thread.js'
import * as AppAtmobbForumAccessRequest from './types/app/atmobb/forum/accessRequest.js'
import * as AppAtmobbForumBoard from './types/app/atmobb/forum/board.js'
import * as AppAtmobbForumCategory from './types/app/atmobb/forum/category.js'
import * as AppAtmobbForumGetAccessRequests from './types/app/atmobb/forum/getAccessRequests.js'
import * as AppAtmobbForumGetBoardIndex from './types/app/atmobb/forum/getBoardIndex.js'
import * as AppAtmobbForumGetDirectory from './types/app/atmobb/forum/getDirectory.js'
import * as AppAtmobbForumGetMembers from './types/app/atmobb/forum/getMembers.js'
import * as AppAtmobbForumGetStaff from './types/app/atmobb/forum/getStaff.js'
import * as AppAtmobbForumGetTopic from './types/app/atmobb/forum/getTopic.js'
import * as AppAtmobbForumGetTopics from './types/app/atmobb/forum/getTopics.js'
import * as AppAtmobbForumMembership from './types/app/atmobb/forum/membership.js'
import * as AppAtmobbForumModerator from './types/app/atmobb/forum/moderator.js'
import * as AppAtmobbForumProfile from './types/app/atmobb/forum/profile.js'
import * as AppAtmobbModerationAction from './types/app/atmobb/moderation/action.js'
import * as AppAtmobbModerationGetLog from './types/app/atmobb/moderation/getLog.js'
import * as AppAtmobbModerationGetStanding from './types/app/atmobb/moderation/getStanding.js'
import * as AppAtmobbPollVote from './types/app/atmobb/poll/vote.js'
import * as AppAtmobbRichtextBlock from './types/app/atmobb/richtext/block.js'
import * as AppAtmobbRichtextFacet from './types/app/atmobb/richtext/facet.js'
import * as ComAtprotoRepoCreateRecord from './types/com/atproto/repo/createRecord.js'
import * as ComAtprotoRepoDefs from './types/com/atproto/repo/defs.js'
import * as ComAtprotoRepoDeleteRecord from './types/com/atproto/repo/deleteRecord.js'
import * as ComAtprotoRepoGetRecord from './types/com/atproto/repo/getRecord.js'
import * as ComAtprotoRepoListRecords from './types/com/atproto/repo/listRecords.js'
import * as ComAtprotoRepoPutRecord from './types/com/atproto/repo/putRecord.js'
import * as ComAtprotoRepoStrongRef from './types/com/atproto/repo/strongRef.js'

export * as AppAtmobbActorGetActivity from './types/app/atmobb/actor/getActivity.js'
export * as AppAtmobbActorProfile from './types/app/atmobb/actor/profile.js'
export * as AppAtmobbDiscussionCreateReply from './types/app/atmobb/discussion/createReply.js'
export * as AppAtmobbDiscussionCreateThread from './types/app/atmobb/discussion/createThread.js'
export * as AppAtmobbDiscussionGetBoardThreads from './types/app/atmobb/discussion/getBoardThreads.js'
export * as AppAtmobbDiscussionGetLatestThreads from './types/app/atmobb/discussion/getLatestThreads.js'
export * as AppAtmobbDiscussionGetThreadPage from './types/app/atmobb/discussion/getThreadPage.js'
export * as AppAtmobbDiscussionReply from './types/app/atmobb/discussion/reply.js'
export * as AppAtmobbDiscussionThread from './types/app/atmobb/discussion/thread.js'
export * as AppAtmobbForumAccessRequest from './types/app/atmobb/forum/accessRequest.js'
export * as AppAtmobbForumBoard from './types/app/atmobb/forum/board.js'
export * as AppAtmobbForumCategory from './types/app/atmobb/forum/category.js'
export * as AppAtmobbForumGetAccessRequests from './types/app/atmobb/forum/getAccessRequests.js'
export * as AppAtmobbForumGetBoardIndex from './types/app/atmobb/forum/getBoardIndex.js'
export * as AppAtmobbForumGetDirectory from './types/app/atmobb/forum/getDirectory.js'
export * as AppAtmobbForumGetMembers from './types/app/atmobb/forum/getMembers.js'
export * as AppAtmobbForumGetStaff from './types/app/atmobb/forum/getStaff.js'
export * as AppAtmobbForumGetTopic from './types/app/atmobb/forum/getTopic.js'
export * as AppAtmobbForumGetTopics from './types/app/atmobb/forum/getTopics.js'
export * as AppAtmobbForumMembership from './types/app/atmobb/forum/membership.js'
export * as AppAtmobbForumModerator from './types/app/atmobb/forum/moderator.js'
export * as AppAtmobbForumProfile from './types/app/atmobb/forum/profile.js'
export * as AppAtmobbModerationAction from './types/app/atmobb/moderation/action.js'
export * as AppAtmobbModerationGetLog from './types/app/atmobb/moderation/getLog.js'
export * as AppAtmobbModerationGetStanding from './types/app/atmobb/moderation/getStanding.js'
export * as AppAtmobbPollVote from './types/app/atmobb/poll/vote.js'
export * as AppAtmobbRichtextBlock from './types/app/atmobb/richtext/block.js'
export * as AppAtmobbRichtextFacet from './types/app/atmobb/richtext/facet.js'
export * as ComAtprotoRepoCreateRecord from './types/com/atproto/repo/createRecord.js'
export * as ComAtprotoRepoDefs from './types/com/atproto/repo/defs.js'
export * as ComAtprotoRepoDeleteRecord from './types/com/atproto/repo/deleteRecord.js'
export * as ComAtprotoRepoGetRecord from './types/com/atproto/repo/getRecord.js'
export * as ComAtprotoRepoListRecords from './types/com/atproto/repo/listRecords.js'
export * as ComAtprotoRepoPutRecord from './types/com/atproto/repo/putRecord.js'
export * as ComAtprotoRepoStrongRef from './types/com/atproto/repo/strongRef.js'

export class AtpBaseClient extends XrpcClient {
  app: AppNS
  com: ComNS

  constructor(options: FetchHandler | FetchHandlerOptions) {
    super(options, schemas)
    this.app = new AppNS(this)
    this.com = new ComNS(this)
  }

  /** @deprecated use `this` instead */
  get xrpc(): XrpcClient {
    return this
  }
}

export class AppNS {
  _client: XrpcClient
  atmobb: AppAtmobbNS

  constructor(client: XrpcClient) {
    this._client = client
    this.atmobb = new AppAtmobbNS(client)
  }
}

export class AppAtmobbNS {
  _client: XrpcClient
  actor: AppAtmobbActorNS
  discussion: AppAtmobbDiscussionNS
  forum: AppAtmobbForumNS
  moderation: AppAtmobbModerationNS
  poll: AppAtmobbPollNS
  richtext: AppAtmobbRichtextNS

  constructor(client: XrpcClient) {
    this._client = client
    this.actor = new AppAtmobbActorNS(client)
    this.discussion = new AppAtmobbDiscussionNS(client)
    this.forum = new AppAtmobbForumNS(client)
    this.moderation = new AppAtmobbModerationNS(client)
    this.poll = new AppAtmobbPollNS(client)
    this.richtext = new AppAtmobbRichtextNS(client)
  }
}

export class AppAtmobbActorNS {
  _client: XrpcClient
  profile: AppAtmobbActorProfileRecord

  constructor(client: XrpcClient) {
    this._client = client
    this.profile = new AppAtmobbActorProfileRecord(client)
  }

  getActivity(
    params?: AppAtmobbActorGetActivity.QueryParams,
    opts?: AppAtmobbActorGetActivity.CallOptions,
  ): Promise<AppAtmobbActorGetActivity.Response> {
    return this._client.call(
      'app.atmobb.actor.getActivity',
      params,
      undefined,
      opts,
    )
  }
}

export class AppAtmobbActorProfileRecord {
  _client: XrpcClient

  constructor(client: XrpcClient) {
    this._client = client
  }

  async list(
    params: OmitKey<ComAtprotoRepoListRecords.QueryParams, 'collection'>,
  ): Promise<{
    cursor?: string
    records: { uri: string; value: AppAtmobbActorProfile.Record }[]
  }> {
    const res = await this._client.call('com.atproto.repo.listRecords', {
      collection: 'app.atmobb.actor.profile',
      ...params,
    })
    return res.data
  }

  async get(
    params: OmitKey<ComAtprotoRepoGetRecord.QueryParams, 'collection'>,
  ): Promise<{
    uri: string
    cid: string
    value: AppAtmobbActorProfile.Record
  }> {
    const res = await this._client.call('com.atproto.repo.getRecord', {
      collection: 'app.atmobb.actor.profile',
      ...params,
    })
    return res.data
  }

  async create(
    params: OmitKey<
      ComAtprotoRepoCreateRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<AppAtmobbActorProfile.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'app.atmobb.actor.profile'
    const res = await this._client.call(
      'com.atproto.repo.createRecord',
      undefined,
      {
        collection,
        rkey: 'self',
        ...params,
        record: { ...record, $type: collection },
      },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async put(
    params: OmitKey<
      ComAtprotoRepoPutRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<AppAtmobbActorProfile.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'app.atmobb.actor.profile'
    const res = await this._client.call(
      'com.atproto.repo.putRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async delete(
    params: OmitKey<ComAtprotoRepoDeleteRecord.InputSchema, 'collection'>,
    headers?: Record<string, string>,
  ): Promise<void> {
    await this._client.call(
      'com.atproto.repo.deleteRecord',
      undefined,
      { collection: 'app.atmobb.actor.profile', ...params },
      { headers },
    )
  }
}

export class AppAtmobbDiscussionNS {
  _client: XrpcClient
  reply: AppAtmobbDiscussionReplyRecord
  thread: AppAtmobbDiscussionThreadRecord

  constructor(client: XrpcClient) {
    this._client = client
    this.reply = new AppAtmobbDiscussionReplyRecord(client)
    this.thread = new AppAtmobbDiscussionThreadRecord(client)
  }

  createReply(
    data?: AppAtmobbDiscussionCreateReply.InputSchema,
    opts?: AppAtmobbDiscussionCreateReply.CallOptions,
  ): Promise<AppAtmobbDiscussionCreateReply.Response> {
    return this._client.call(
      'app.atmobb.discussion.createReply',
      opts?.qp,
      data,
      opts,
    )
  }

  createThread(
    data?: AppAtmobbDiscussionCreateThread.InputSchema,
    opts?: AppAtmobbDiscussionCreateThread.CallOptions,
  ): Promise<AppAtmobbDiscussionCreateThread.Response> {
    return this._client.call(
      'app.atmobb.discussion.createThread',
      opts?.qp,
      data,
      opts,
    )
  }

  getBoardThreads(
    params?: AppAtmobbDiscussionGetBoardThreads.QueryParams,
    opts?: AppAtmobbDiscussionGetBoardThreads.CallOptions,
  ): Promise<AppAtmobbDiscussionGetBoardThreads.Response> {
    return this._client.call(
      'app.atmobb.discussion.getBoardThreads',
      params,
      undefined,
      opts,
    )
  }

  getLatestThreads(
    params?: AppAtmobbDiscussionGetLatestThreads.QueryParams,
    opts?: AppAtmobbDiscussionGetLatestThreads.CallOptions,
  ): Promise<AppAtmobbDiscussionGetLatestThreads.Response> {
    return this._client.call(
      'app.atmobb.discussion.getLatestThreads',
      params,
      undefined,
      opts,
    )
  }

  getThreadPage(
    params?: AppAtmobbDiscussionGetThreadPage.QueryParams,
    opts?: AppAtmobbDiscussionGetThreadPage.CallOptions,
  ): Promise<AppAtmobbDiscussionGetThreadPage.Response> {
    return this._client.call(
      'app.atmobb.discussion.getThreadPage',
      params,
      undefined,
      opts,
    )
  }
}

export class AppAtmobbDiscussionReplyRecord {
  _client: XrpcClient

  constructor(client: XrpcClient) {
    this._client = client
  }

  async list(
    params: OmitKey<ComAtprotoRepoListRecords.QueryParams, 'collection'>,
  ): Promise<{
    cursor?: string
    records: { uri: string; value: AppAtmobbDiscussionReply.Record }[]
  }> {
    const res = await this._client.call('com.atproto.repo.listRecords', {
      collection: 'app.atmobb.discussion.reply',
      ...params,
    })
    return res.data
  }

  async get(
    params: OmitKey<ComAtprotoRepoGetRecord.QueryParams, 'collection'>,
  ): Promise<{
    uri: string
    cid: string
    value: AppAtmobbDiscussionReply.Record
  }> {
    const res = await this._client.call('com.atproto.repo.getRecord', {
      collection: 'app.atmobb.discussion.reply',
      ...params,
    })
    return res.data
  }

  async create(
    params: OmitKey<
      ComAtprotoRepoCreateRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<AppAtmobbDiscussionReply.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'app.atmobb.discussion.reply'
    const res = await this._client.call(
      'com.atproto.repo.createRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async put(
    params: OmitKey<
      ComAtprotoRepoPutRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<AppAtmobbDiscussionReply.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'app.atmobb.discussion.reply'
    const res = await this._client.call(
      'com.atproto.repo.putRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async delete(
    params: OmitKey<ComAtprotoRepoDeleteRecord.InputSchema, 'collection'>,
    headers?: Record<string, string>,
  ): Promise<void> {
    await this._client.call(
      'com.atproto.repo.deleteRecord',
      undefined,
      { collection: 'app.atmobb.discussion.reply', ...params },
      { headers },
    )
  }
}

export class AppAtmobbDiscussionThreadRecord {
  _client: XrpcClient

  constructor(client: XrpcClient) {
    this._client = client
  }

  async list(
    params: OmitKey<ComAtprotoRepoListRecords.QueryParams, 'collection'>,
  ): Promise<{
    cursor?: string
    records: { uri: string; value: AppAtmobbDiscussionThread.Record }[]
  }> {
    const res = await this._client.call('com.atproto.repo.listRecords', {
      collection: 'app.atmobb.discussion.thread',
      ...params,
    })
    return res.data
  }

  async get(
    params: OmitKey<ComAtprotoRepoGetRecord.QueryParams, 'collection'>,
  ): Promise<{
    uri: string
    cid: string
    value: AppAtmobbDiscussionThread.Record
  }> {
    const res = await this._client.call('com.atproto.repo.getRecord', {
      collection: 'app.atmobb.discussion.thread',
      ...params,
    })
    return res.data
  }

  async create(
    params: OmitKey<
      ComAtprotoRepoCreateRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<AppAtmobbDiscussionThread.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'app.atmobb.discussion.thread'
    const res = await this._client.call(
      'com.atproto.repo.createRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async put(
    params: OmitKey<
      ComAtprotoRepoPutRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<AppAtmobbDiscussionThread.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'app.atmobb.discussion.thread'
    const res = await this._client.call(
      'com.atproto.repo.putRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async delete(
    params: OmitKey<ComAtprotoRepoDeleteRecord.InputSchema, 'collection'>,
    headers?: Record<string, string>,
  ): Promise<void> {
    await this._client.call(
      'com.atproto.repo.deleteRecord',
      undefined,
      { collection: 'app.atmobb.discussion.thread', ...params },
      { headers },
    )
  }
}

export class AppAtmobbForumNS {
  _client: XrpcClient
  accessRequest: AppAtmobbForumAccessRequestRecord
  board: AppAtmobbForumBoardRecord
  category: AppAtmobbForumCategoryRecord
  membership: AppAtmobbForumMembershipRecord
  moderator: AppAtmobbForumModeratorRecord
  profile: AppAtmobbForumProfileRecord

  constructor(client: XrpcClient) {
    this._client = client
    this.accessRequest = new AppAtmobbForumAccessRequestRecord(client)
    this.board = new AppAtmobbForumBoardRecord(client)
    this.category = new AppAtmobbForumCategoryRecord(client)
    this.membership = new AppAtmobbForumMembershipRecord(client)
    this.moderator = new AppAtmobbForumModeratorRecord(client)
    this.profile = new AppAtmobbForumProfileRecord(client)
  }

  getAccessRequests(
    params?: AppAtmobbForumGetAccessRequests.QueryParams,
    opts?: AppAtmobbForumGetAccessRequests.CallOptions,
  ): Promise<AppAtmobbForumGetAccessRequests.Response> {
    return this._client.call(
      'app.atmobb.forum.getAccessRequests',
      params,
      undefined,
      opts,
    )
  }

  getBoardIndex(
    params?: AppAtmobbForumGetBoardIndex.QueryParams,
    opts?: AppAtmobbForumGetBoardIndex.CallOptions,
  ): Promise<AppAtmobbForumGetBoardIndex.Response> {
    return this._client.call(
      'app.atmobb.forum.getBoardIndex',
      params,
      undefined,
      opts,
    )
  }

  getDirectory(
    params?: AppAtmobbForumGetDirectory.QueryParams,
    opts?: AppAtmobbForumGetDirectory.CallOptions,
  ): Promise<AppAtmobbForumGetDirectory.Response> {
    return this._client.call(
      'app.atmobb.forum.getDirectory',
      params,
      undefined,
      opts,
    )
  }

  getMembers(
    params?: AppAtmobbForumGetMembers.QueryParams,
    opts?: AppAtmobbForumGetMembers.CallOptions,
  ): Promise<AppAtmobbForumGetMembers.Response> {
    return this._client.call(
      'app.atmobb.forum.getMembers',
      params,
      undefined,
      opts,
    )
  }

  getStaff(
    params?: AppAtmobbForumGetStaff.QueryParams,
    opts?: AppAtmobbForumGetStaff.CallOptions,
  ): Promise<AppAtmobbForumGetStaff.Response> {
    return this._client.call(
      'app.atmobb.forum.getStaff',
      params,
      undefined,
      opts,
    )
  }

  getTopic(
    params?: AppAtmobbForumGetTopic.QueryParams,
    opts?: AppAtmobbForumGetTopic.CallOptions,
  ): Promise<AppAtmobbForumGetTopic.Response> {
    return this._client.call(
      'app.atmobb.forum.getTopic',
      params,
      undefined,
      opts,
    )
  }

  getTopics(
    params?: AppAtmobbForumGetTopics.QueryParams,
    opts?: AppAtmobbForumGetTopics.CallOptions,
  ): Promise<AppAtmobbForumGetTopics.Response> {
    return this._client.call(
      'app.atmobb.forum.getTopics',
      params,
      undefined,
      opts,
    )
  }
}

export class AppAtmobbForumAccessRequestRecord {
  _client: XrpcClient

  constructor(client: XrpcClient) {
    this._client = client
  }

  async list(
    params: OmitKey<ComAtprotoRepoListRecords.QueryParams, 'collection'>,
  ): Promise<{
    cursor?: string
    records: { uri: string; value: AppAtmobbForumAccessRequest.Record }[]
  }> {
    const res = await this._client.call('com.atproto.repo.listRecords', {
      collection: 'app.atmobb.forum.accessRequest',
      ...params,
    })
    return res.data
  }

  async get(
    params: OmitKey<ComAtprotoRepoGetRecord.QueryParams, 'collection'>,
  ): Promise<{
    uri: string
    cid: string
    value: AppAtmobbForumAccessRequest.Record
  }> {
    const res = await this._client.call('com.atproto.repo.getRecord', {
      collection: 'app.atmobb.forum.accessRequest',
      ...params,
    })
    return res.data
  }

  async create(
    params: OmitKey<
      ComAtprotoRepoCreateRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<AppAtmobbForumAccessRequest.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'app.atmobb.forum.accessRequest'
    const res = await this._client.call(
      'com.atproto.repo.createRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async put(
    params: OmitKey<
      ComAtprotoRepoPutRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<AppAtmobbForumAccessRequest.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'app.atmobb.forum.accessRequest'
    const res = await this._client.call(
      'com.atproto.repo.putRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async delete(
    params: OmitKey<ComAtprotoRepoDeleteRecord.InputSchema, 'collection'>,
    headers?: Record<string, string>,
  ): Promise<void> {
    await this._client.call(
      'com.atproto.repo.deleteRecord',
      undefined,
      { collection: 'app.atmobb.forum.accessRequest', ...params },
      { headers },
    )
  }
}

export class AppAtmobbForumBoardRecord {
  _client: XrpcClient

  constructor(client: XrpcClient) {
    this._client = client
  }

  async list(
    params: OmitKey<ComAtprotoRepoListRecords.QueryParams, 'collection'>,
  ): Promise<{
    cursor?: string
    records: { uri: string; value: AppAtmobbForumBoard.Record }[]
  }> {
    const res = await this._client.call('com.atproto.repo.listRecords', {
      collection: 'app.atmobb.forum.board',
      ...params,
    })
    return res.data
  }

  async get(
    params: OmitKey<ComAtprotoRepoGetRecord.QueryParams, 'collection'>,
  ): Promise<{ uri: string; cid: string; value: AppAtmobbForumBoard.Record }> {
    const res = await this._client.call('com.atproto.repo.getRecord', {
      collection: 'app.atmobb.forum.board',
      ...params,
    })
    return res.data
  }

  async create(
    params: OmitKey<
      ComAtprotoRepoCreateRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<AppAtmobbForumBoard.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'app.atmobb.forum.board'
    const res = await this._client.call(
      'com.atproto.repo.createRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async put(
    params: OmitKey<
      ComAtprotoRepoPutRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<AppAtmobbForumBoard.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'app.atmobb.forum.board'
    const res = await this._client.call(
      'com.atproto.repo.putRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async delete(
    params: OmitKey<ComAtprotoRepoDeleteRecord.InputSchema, 'collection'>,
    headers?: Record<string, string>,
  ): Promise<void> {
    await this._client.call(
      'com.atproto.repo.deleteRecord',
      undefined,
      { collection: 'app.atmobb.forum.board', ...params },
      { headers },
    )
  }
}

export class AppAtmobbForumCategoryRecord {
  _client: XrpcClient

  constructor(client: XrpcClient) {
    this._client = client
  }

  async list(
    params: OmitKey<ComAtprotoRepoListRecords.QueryParams, 'collection'>,
  ): Promise<{
    cursor?: string
    records: { uri: string; value: AppAtmobbForumCategory.Record }[]
  }> {
    const res = await this._client.call('com.atproto.repo.listRecords', {
      collection: 'app.atmobb.forum.category',
      ...params,
    })
    return res.data
  }

  async get(
    params: OmitKey<ComAtprotoRepoGetRecord.QueryParams, 'collection'>,
  ): Promise<{
    uri: string
    cid: string
    value: AppAtmobbForumCategory.Record
  }> {
    const res = await this._client.call('com.atproto.repo.getRecord', {
      collection: 'app.atmobb.forum.category',
      ...params,
    })
    return res.data
  }

  async create(
    params: OmitKey<
      ComAtprotoRepoCreateRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<AppAtmobbForumCategory.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'app.atmobb.forum.category'
    const res = await this._client.call(
      'com.atproto.repo.createRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async put(
    params: OmitKey<
      ComAtprotoRepoPutRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<AppAtmobbForumCategory.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'app.atmobb.forum.category'
    const res = await this._client.call(
      'com.atproto.repo.putRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async delete(
    params: OmitKey<ComAtprotoRepoDeleteRecord.InputSchema, 'collection'>,
    headers?: Record<string, string>,
  ): Promise<void> {
    await this._client.call(
      'com.atproto.repo.deleteRecord',
      undefined,
      { collection: 'app.atmobb.forum.category', ...params },
      { headers },
    )
  }
}

export class AppAtmobbForumMembershipRecord {
  _client: XrpcClient

  constructor(client: XrpcClient) {
    this._client = client
  }

  async list(
    params: OmitKey<ComAtprotoRepoListRecords.QueryParams, 'collection'>,
  ): Promise<{
    cursor?: string
    records: { uri: string; value: AppAtmobbForumMembership.Record }[]
  }> {
    const res = await this._client.call('com.atproto.repo.listRecords', {
      collection: 'app.atmobb.forum.membership',
      ...params,
    })
    return res.data
  }

  async get(
    params: OmitKey<ComAtprotoRepoGetRecord.QueryParams, 'collection'>,
  ): Promise<{
    uri: string
    cid: string
    value: AppAtmobbForumMembership.Record
  }> {
    const res = await this._client.call('com.atproto.repo.getRecord', {
      collection: 'app.atmobb.forum.membership',
      ...params,
    })
    return res.data
  }

  async create(
    params: OmitKey<
      ComAtprotoRepoCreateRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<AppAtmobbForumMembership.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'app.atmobb.forum.membership'
    const res = await this._client.call(
      'com.atproto.repo.createRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async put(
    params: OmitKey<
      ComAtprotoRepoPutRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<AppAtmobbForumMembership.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'app.atmobb.forum.membership'
    const res = await this._client.call(
      'com.atproto.repo.putRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async delete(
    params: OmitKey<ComAtprotoRepoDeleteRecord.InputSchema, 'collection'>,
    headers?: Record<string, string>,
  ): Promise<void> {
    await this._client.call(
      'com.atproto.repo.deleteRecord',
      undefined,
      { collection: 'app.atmobb.forum.membership', ...params },
      { headers },
    )
  }
}

export class AppAtmobbForumModeratorRecord {
  _client: XrpcClient

  constructor(client: XrpcClient) {
    this._client = client
  }

  async list(
    params: OmitKey<ComAtprotoRepoListRecords.QueryParams, 'collection'>,
  ): Promise<{
    cursor?: string
    records: { uri: string; value: AppAtmobbForumModerator.Record }[]
  }> {
    const res = await this._client.call('com.atproto.repo.listRecords', {
      collection: 'app.atmobb.forum.moderator',
      ...params,
    })
    return res.data
  }

  async get(
    params: OmitKey<ComAtprotoRepoGetRecord.QueryParams, 'collection'>,
  ): Promise<{
    uri: string
    cid: string
    value: AppAtmobbForumModerator.Record
  }> {
    const res = await this._client.call('com.atproto.repo.getRecord', {
      collection: 'app.atmobb.forum.moderator',
      ...params,
    })
    return res.data
  }

  async create(
    params: OmitKey<
      ComAtprotoRepoCreateRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<AppAtmobbForumModerator.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'app.atmobb.forum.moderator'
    const res = await this._client.call(
      'com.atproto.repo.createRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async put(
    params: OmitKey<
      ComAtprotoRepoPutRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<AppAtmobbForumModerator.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'app.atmobb.forum.moderator'
    const res = await this._client.call(
      'com.atproto.repo.putRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async delete(
    params: OmitKey<ComAtprotoRepoDeleteRecord.InputSchema, 'collection'>,
    headers?: Record<string, string>,
  ): Promise<void> {
    await this._client.call(
      'com.atproto.repo.deleteRecord',
      undefined,
      { collection: 'app.atmobb.forum.moderator', ...params },
      { headers },
    )
  }
}

export class AppAtmobbForumProfileRecord {
  _client: XrpcClient

  constructor(client: XrpcClient) {
    this._client = client
  }

  async list(
    params: OmitKey<ComAtprotoRepoListRecords.QueryParams, 'collection'>,
  ): Promise<{
    cursor?: string
    records: { uri: string; value: AppAtmobbForumProfile.Record }[]
  }> {
    const res = await this._client.call('com.atproto.repo.listRecords', {
      collection: 'app.atmobb.forum.profile',
      ...params,
    })
    return res.data
  }

  async get(
    params: OmitKey<ComAtprotoRepoGetRecord.QueryParams, 'collection'>,
  ): Promise<{
    uri: string
    cid: string
    value: AppAtmobbForumProfile.Record
  }> {
    const res = await this._client.call('com.atproto.repo.getRecord', {
      collection: 'app.atmobb.forum.profile',
      ...params,
    })
    return res.data
  }

  async create(
    params: OmitKey<
      ComAtprotoRepoCreateRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<AppAtmobbForumProfile.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'app.atmobb.forum.profile'
    const res = await this._client.call(
      'com.atproto.repo.createRecord',
      undefined,
      {
        collection,
        rkey: 'self',
        ...params,
        record: { ...record, $type: collection },
      },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async put(
    params: OmitKey<
      ComAtprotoRepoPutRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<AppAtmobbForumProfile.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'app.atmobb.forum.profile'
    const res = await this._client.call(
      'com.atproto.repo.putRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async delete(
    params: OmitKey<ComAtprotoRepoDeleteRecord.InputSchema, 'collection'>,
    headers?: Record<string, string>,
  ): Promise<void> {
    await this._client.call(
      'com.atproto.repo.deleteRecord',
      undefined,
      { collection: 'app.atmobb.forum.profile', ...params },
      { headers },
    )
  }
}

export class AppAtmobbModerationNS {
  _client: XrpcClient
  action: AppAtmobbModerationActionRecord

  constructor(client: XrpcClient) {
    this._client = client
    this.action = new AppAtmobbModerationActionRecord(client)
  }

  getLog(
    params?: AppAtmobbModerationGetLog.QueryParams,
    opts?: AppAtmobbModerationGetLog.CallOptions,
  ): Promise<AppAtmobbModerationGetLog.Response> {
    return this._client.call(
      'app.atmobb.moderation.getLog',
      params,
      undefined,
      opts,
    )
  }

  getStanding(
    params?: AppAtmobbModerationGetStanding.QueryParams,
    opts?: AppAtmobbModerationGetStanding.CallOptions,
  ): Promise<AppAtmobbModerationGetStanding.Response> {
    return this._client.call(
      'app.atmobb.moderation.getStanding',
      params,
      undefined,
      opts,
    )
  }
}

export class AppAtmobbModerationActionRecord {
  _client: XrpcClient

  constructor(client: XrpcClient) {
    this._client = client
  }

  async list(
    params: OmitKey<ComAtprotoRepoListRecords.QueryParams, 'collection'>,
  ): Promise<{
    cursor?: string
    records: { uri: string; value: AppAtmobbModerationAction.Record }[]
  }> {
    const res = await this._client.call('com.atproto.repo.listRecords', {
      collection: 'app.atmobb.moderation.action',
      ...params,
    })
    return res.data
  }

  async get(
    params: OmitKey<ComAtprotoRepoGetRecord.QueryParams, 'collection'>,
  ): Promise<{
    uri: string
    cid: string
    value: AppAtmobbModerationAction.Record
  }> {
    const res = await this._client.call('com.atproto.repo.getRecord', {
      collection: 'app.atmobb.moderation.action',
      ...params,
    })
    return res.data
  }

  async create(
    params: OmitKey<
      ComAtprotoRepoCreateRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<AppAtmobbModerationAction.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'app.atmobb.moderation.action'
    const res = await this._client.call(
      'com.atproto.repo.createRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async put(
    params: OmitKey<
      ComAtprotoRepoPutRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<AppAtmobbModerationAction.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'app.atmobb.moderation.action'
    const res = await this._client.call(
      'com.atproto.repo.putRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async delete(
    params: OmitKey<ComAtprotoRepoDeleteRecord.InputSchema, 'collection'>,
    headers?: Record<string, string>,
  ): Promise<void> {
    await this._client.call(
      'com.atproto.repo.deleteRecord',
      undefined,
      { collection: 'app.atmobb.moderation.action', ...params },
      { headers },
    )
  }
}

export class AppAtmobbPollNS {
  _client: XrpcClient
  vote: AppAtmobbPollVoteRecord

  constructor(client: XrpcClient) {
    this._client = client
    this.vote = new AppAtmobbPollVoteRecord(client)
  }
}

export class AppAtmobbPollVoteRecord {
  _client: XrpcClient

  constructor(client: XrpcClient) {
    this._client = client
  }

  async list(
    params: OmitKey<ComAtprotoRepoListRecords.QueryParams, 'collection'>,
  ): Promise<{
    cursor?: string
    records: { uri: string; value: AppAtmobbPollVote.Record }[]
  }> {
    const res = await this._client.call('com.atproto.repo.listRecords', {
      collection: 'app.atmobb.poll.vote',
      ...params,
    })
    return res.data
  }

  async get(
    params: OmitKey<ComAtprotoRepoGetRecord.QueryParams, 'collection'>,
  ): Promise<{ uri: string; cid: string; value: AppAtmobbPollVote.Record }> {
    const res = await this._client.call('com.atproto.repo.getRecord', {
      collection: 'app.atmobb.poll.vote',
      ...params,
    })
    return res.data
  }

  async create(
    params: OmitKey<
      ComAtprotoRepoCreateRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<AppAtmobbPollVote.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'app.atmobb.poll.vote'
    const res = await this._client.call(
      'com.atproto.repo.createRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async put(
    params: OmitKey<
      ComAtprotoRepoPutRecord.InputSchema,
      'collection' | 'record'
    >,
    record: Un$Typed<AppAtmobbPollVote.Record>,
    headers?: Record<string, string>,
  ): Promise<{ uri: string; cid: string }> {
    const collection = 'app.atmobb.poll.vote'
    const res = await this._client.call(
      'com.atproto.repo.putRecord',
      undefined,
      { collection, ...params, record: { ...record, $type: collection } },
      { encoding: 'application/json', headers },
    )
    return res.data
  }

  async delete(
    params: OmitKey<ComAtprotoRepoDeleteRecord.InputSchema, 'collection'>,
    headers?: Record<string, string>,
  ): Promise<void> {
    await this._client.call(
      'com.atproto.repo.deleteRecord',
      undefined,
      { collection: 'app.atmobb.poll.vote', ...params },
      { headers },
    )
  }
}

export class AppAtmobbRichtextNS {
  _client: XrpcClient

  constructor(client: XrpcClient) {
    this._client = client
  }
}

export class ComNS {
  _client: XrpcClient
  atproto: ComAtprotoNS

  constructor(client: XrpcClient) {
    this._client = client
    this.atproto = new ComAtprotoNS(client)
  }
}

export class ComAtprotoNS {
  _client: XrpcClient
  repo: ComAtprotoRepoNS

  constructor(client: XrpcClient) {
    this._client = client
    this.repo = new ComAtprotoRepoNS(client)
  }
}

export class ComAtprotoRepoNS {
  _client: XrpcClient

  constructor(client: XrpcClient) {
    this._client = client
  }

  createRecord(
    data?: ComAtprotoRepoCreateRecord.InputSchema,
    opts?: ComAtprotoRepoCreateRecord.CallOptions,
  ): Promise<ComAtprotoRepoCreateRecord.Response> {
    return this._client
      .call('com.atproto.repo.createRecord', opts?.qp, data, opts)
      .catch((e) => {
        throw ComAtprotoRepoCreateRecord.toKnownErr(e)
      })
  }

  deleteRecord(
    data?: ComAtprotoRepoDeleteRecord.InputSchema,
    opts?: ComAtprotoRepoDeleteRecord.CallOptions,
  ): Promise<ComAtprotoRepoDeleteRecord.Response> {
    return this._client
      .call('com.atproto.repo.deleteRecord', opts?.qp, data, opts)
      .catch((e) => {
        throw ComAtprotoRepoDeleteRecord.toKnownErr(e)
      })
  }

  getRecord(
    params?: ComAtprotoRepoGetRecord.QueryParams,
    opts?: ComAtprotoRepoGetRecord.CallOptions,
  ): Promise<ComAtprotoRepoGetRecord.Response> {
    return this._client
      .call('com.atproto.repo.getRecord', params, undefined, opts)
      .catch((e) => {
        throw ComAtprotoRepoGetRecord.toKnownErr(e)
      })
  }

  listRecords(
    params?: ComAtprotoRepoListRecords.QueryParams,
    opts?: ComAtprotoRepoListRecords.CallOptions,
  ): Promise<ComAtprotoRepoListRecords.Response> {
    return this._client.call(
      'com.atproto.repo.listRecords',
      params,
      undefined,
      opts,
    )
  }

  putRecord(
    data?: ComAtprotoRepoPutRecord.InputSchema,
    opts?: ComAtprotoRepoPutRecord.CallOptions,
  ): Promise<ComAtprotoRepoPutRecord.Response> {
    return this._client
      .call('com.atproto.repo.putRecord', opts?.qp, data, opts)
      .catch((e) => {
        throw ComAtprotoRepoPutRecord.toKnownErr(e)
      })
  }
}
