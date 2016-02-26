#!/usr/bin/env python
# -*- coding: utf-8 -*-

###############################################################################
#  Copyright Kitware Inc.
#
#  Licensed under the Apache License, Version 2.0 ( the "License" );
#  you may not use this file except in compliance with the License.
#  You may obtain a copy of the License at
#
#    http://www.apache.org/licenses/LICENSE-2.0
#
#  Unless required by applicable law or agreed to in writing, software
#  distributed under the License is distributed on an "AS IS" BASIS,
#  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
#  See the License for the specific language governing permissions and
#  limitations under the License.
###############################################################################

from girder.api import access
from girder.api.describe import Description, describeRoute
from girder.api.rest import Resource

from girder.utility.model_importer import ModelImporter
from girder.api.rest import getBodyJson, getCurrentUser

from girder.plugins.imagespace import solr_documents_from_field

from .utils import getCreateSessionsFolder

import json
import requests
import os


class SmqtkIqr(Resource):
    def __init__(self):
        self.search_url = os.environ['IMAGE_SPACE_SMQTK_IQR_URL']
        self.resourceName = 'smqtk_iqr'
        self.route('POST', ('session',), self.createSession)
        self.route('GET', ('session',), self.getSessions)
        self.route('PUT', ('refine',), self.refine)
        self.route('GET', ('results',), self.results)

    @access.user
    @describeRoute(
        Description('Get all session items')
    )
    def getSessions(self, params):
        sessionsFolder = getCreateSessionsFolder()
        return list(ModelImporter.model('folder').childItems(folder=sessionsFolder))

    @access.user
    @describeRoute(
        Description('Create an IQR session, return the Girder Item representing that session')
    )
    def createSession(self, params):
        sessionsFolder = getCreateSessionsFolder()
        sessionId = requests.post(self.search_url + '/session').json()['sid']
        return ModelImporter.model('item').createItem(name=sessionId,
                                                      creator=getCurrentUser(),
                                                      folder=sessionsFolder)
        # create sessions folder in private directory if not existing
        # post to init_session, get sid back
        # create item named sid in sessions folder

    @access.user
    @describeRoute(
        Description('Refine results based on positive and negative uuids')
        .param('body', 'A JSON object containing the sid and pos_uuids and neg_uuids.',
               paramType='body')
    )
    def refine(self, params):
        params = getBodyJson()
        r = requests.put(self.search_url + '/refine', data={
            'sid': params['sid'],
            'pos_uuids': json.dumps(params['pos_uuids']),
            'neg_uuids': json.dumps(params['neg_uuids'])
        })

        return r.json()

    @access.user
    @describeRoute(
        Description('Get the results of an IQR session')
        .param('sid', 'ID of the IQR session')
        .param('offset', 'Where to start from')
        .param('limit', 'How many records to pull')
    )
    def results(self, params):
        offset = int(params['offset'] if 'offset' in params else 0)
        limit = int(params['limit'] if 'limit' in params else 20)

        resp = requests.get(self.search_url + '/get_results', params={
            'sid': params['sid'],
            'i': offset,
            'j': offset + limit
        }).json() # @todo handle errors

        documents = solr_documents_from_field('sha1sum_s_md', [sha for (sha, _) in resp['results']])

        # The documents from Solr (since shas map to >= 1 document) may not be in the order of confidence
        # returned by IQR, sort the documents to match the confidence values.
        # Sort by confidence values first, then sha checksums second so duplicate images are grouped together
        confidenceValues = dict(resp['results'])  # Mapping of sha -> confidence values

        for document in documents:
            document['smqtk_iqr_confidence'] = confidenceValues[document['sha1sum_s_md']]

        return {
            'numFound': resp['total_results'],
            'docs': sorted(documents,
                           key=lambda x: (x['smqtk_iqr_confidence'],
                                          x['sha1sum_s_md']),
                           reverse=True)
        }
