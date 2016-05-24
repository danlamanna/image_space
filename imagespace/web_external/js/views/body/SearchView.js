imagespace.views.SearchView = imagespace.View.extend({
    events: {
        'change .im-view-list': function (event) {
            localStorage.setItem('viewMode', 'list');
            this.viewMode = 'list';
            this.render();
        },

        'change .im-view-grid': function (event) {
            localStorage.setItem('viewMode', 'grid');
            this.viewMode = 'grid';
            this.render();
        },

        'change #im-classification-narrow input': function (event) {
            this.collection.params.classifications = [];

            $('#im-classification-narrow input:checked').map(_.bind(function (i, el) {
                this.collection.params.classifications.push($(el).data('key'));
            }, this));

            imagespace.updateQueryParams({
                classifications: this.collection.params.classifications.join(',')
            });

            $('.alert-info').html('Narrowing results <i class="icon-spin5 animate-spin"></i>').removeClass('hidden');
            this.collection.fetch(this.collection.params, true);
        }
    },

    initialize: function (settings) {
        girder.cancelRestRequests('fetch');
        this.$el = window.app.$('#g-app-body-container');
        this.collection = settings.collection;
        this.searchImage = settings.searchImage || false;
        this.url = settings.url;
        this.mode = settings.mode;
        this.viewMode = localStorage.getItem('viewMode') || 'grid';
        this.collection.on('g:changed', _.bind(function () {
            this.render();

            if (this.collection.supportsPagination) {
                /**
                 * In the case of coercing a search to be page 1, skip adding both the unpaginated
                 * and paginated URLs to the history (breaking the back button).
                 **/
                imagespace.updateQueryParams({
                    page: this.collection.pageNum() + 1
                }, this.collection.pageNum() == 0);
            }

            $('.alert-info').addClass('hidden');
        }, this));
        this.collection.fetch(this.collection.params || {});
    },

    render: function () {
        this.$el.html(imagespace.templates.search({
            image: this.searchImage,
            mode: this.mode,
            url: this.url,
            viewMode: this.viewMode,
            showText: true,
            collection: this.collection,
            classifications: this.collection.params.classifications
        }));

        if (this.collection.supportsPagination) {
            this.paginateWidget = new girder.views.PaginateWidget({
                collection: this.collection,
                parentView: this
            });
        }

        this.collection.each(function (image) {
            var imageView = new imagespace.views.ImageView({
                model: image,
                viewMode: this.viewMode,
                parentView: this
            });

            this.$('#im-search-results').append(imageView.render().el);
        }, this);

        $('.alert-info').addClass('hidden');

        if (this.collection.supportsPagination) {
            this.paginateWidget.setElement(this.$('.im-pagination-container')).render();
        }

        return this;
    }

});

imagespace.router.route('search/:query(/params/:params)', 'search', function (query, params) {
    imagespace.headerView.render({query: query});
    $('.alert-info').html('Searching <i class="icon-spin5 animate-spin"></i>').removeClass('hidden');

    if (_.has(imagespace, 'searchView')) {
        imagespace.searchView.destroy();
    }

    imagespace.searchView = new imagespace.views.SearchView({
        collection: imagespace.getImageCollectionFromQuery(query),
        parentView: window.app
    });
});

imagespace.router.route('search/:url/:mode(/params/:params)', 'search', function (url, mode, params) {
    // Replace Girder token with current session's token if necessary
    var niceName = (_.has(imagespace.searches[mode], 'niceName')) ? imagespace.searches[mode].niceName : mode,
        parts = url.split('&token=');

    $('.alert-info').html('Performing ' + niceName  + ' search <i class="icon-spin5 animate-spin"></i>').removeClass('hidden');

    if (parts.length === 2) {
        url = parts[0] + '&token=' + girder.cookie.find('girderToken');
    }

    var performSearch = function (image) {
        image.imageUrl = url;

        if (!(image instanceof imagespace.models.ImageModel)) {
            image = (url.indexOf('girder') !== -1) ?
                new imagespace.models.UploadedImageModel(image) :
                new imagespace.models.ImageModel(image);
        }

        imagespace.headerView.render({
            url: url,
            mode: mode, // @todo do these need image/mode?
            image: image
        });
        $('.alert-info').html('Performing ' + niceName  + ' search <i class="icon-spin5 animate-spin"></i>').removeClass('hidden');

        girder.events.trigger('g:navigateTo', imagespace.views.SearchView, {
            collection: imagespace.searches[mode].search(image),
            searchImage: image,
            url: url,
            mode: mode
        });

        imagespace.userDataView.render();

        $('.modal-open').css('overflow', 'auto');
    };

    girder.restRequest({
        path: 'imagesearch',
        data: {
            query: 'id:"' + imagespace.urlToSolrId(url) + '" OR id:"' + imagespace.oppositeCaseFilename(imagespace.urlToSolrId(url)) + '"'
        }
    }).done(function (results) {
        var q;
        results = imagespace.processResponse(results);
        if (results.numFound === 0) {
            $('.alert-info').html('Computing features <i class="icon-spin5 animate-spin"></i>').removeClass('hidden');
            girder.restRequest({
                path: 'imagefeatures',
                data: {
                    url: url
                },
                method: 'POST'
            }).done(function (features) {
                $('.alert-info').addClass('hidden');
                performSearch(features);
            });
        } else {
            performSearch(_.first(results.docs));
        }
    });
});
