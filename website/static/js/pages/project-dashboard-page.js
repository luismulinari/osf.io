/** Initialization code for the project overview page. */
'use strict';

var $ = require('jquery');
require('jquery-tagsinput');
require('bootstrap-editable');
require('js/osfToggleHeight');

var m = require('mithril');
var Fangorn = require('js/fangorn');
var Raven = require('raven-js');
var lodashGet  = require('lodash.get');
require('truncate');

var $osf = require('js/osfHelpers');
var LogFeed = require('js/components/logFeed');
var pointers = require('js/pointers');
var Comment = require('js/comment'); //jshint ignore:line
var NodeControl = require('js/nodeControl');
var CitationList = require('js/citationList');
var CitationWidget = require('js/citationWidget');
var mathrender = require('js/mathrender');
var md = require('js/markdown').full;
var AddProject = require('js/addProjectPlugin');
var mHelpers = require('js/mithrilHelpers');

var ctx = window.contextVars;
var node = window.contextVars.node;
var nodeApiUrl = ctx.node.urls.api;
var nodeCategories = ctx.nodeCategories || {};

var categoryList = m.prop([]);
var addProjectTemplate = m.component(AddProject, {
    buttonTemplate: m('.btn.btn-sm.btn-default[data-toggle="modal"][data-target="#addSubComponent"]', {onclick: function() {
        $osf.trackClick('project-dashboard', 'add-component', 'open-add-project-modal');
    }}, 'Add Component'),
    modalID: 'addSubComponent',
    title: 'Create new component',
    parentID: window.contextVars.node.id,
    parentTitle: window.contextVars.node.title,
    categoryList: categoryList,
    stayCallback: function() {
        // We need to reload because the components list needs to be re-rendered serverside
        window.location.reload();
    },
    trackingCategory: 'project-dashboard',
    trackingAction: 'add-component',
    contributors: window.contextVars.node.contributors,
    currentUserCanEdit: window.contextVars.currentUser.canEdit
});
m.mount(document.getElementById('newComponent'), m.component(addProjectTemplate, {wrapperSelector : '#addSubComponent'}));

// Listen for the nodeLoad event (prevents multiple requests for data)
$('body').on('nodeLoad', function(event, data) {
    if (!data.node.is_retracted) {
        // Initialize controller for "Add Links" modal
        new pointers.PointerManager('#addPointer', window.contextVars.node.title);
    }
    // Initialize CitationWidget if user isn't viewing through an anonymized VOL
    if (!data.node.anonymous && !data.node.is_retracted) {
        var citations = data.node.alternative_citations;
        new CitationList('#citationList', citations, data.user);
        new CitationWidget('#citationStyleInput', '#citationText');
    }
    // Initialize nodeControl
    new NodeControl.NodeControl('#projectScope', data, {categories: nodeCategories});
});

// Initialize comment pane w/ its viewmodel
var $comments = $('.comments');
if ($comments.length) {
    var options = {
        nodeId : window.contextVars.node.id,
        nodeApiUrl: window.contextVars.node.urls.api,
        isRegistration: window.contextVars.node.isRegistration,
        page: 'node',
        rootId: window.contextVars.node.id,
        fileId: null,
        canComment: window.contextVars.currentUser.canComment,
        hasChildren: window.contextVars.node.hasChildren,
        currentUser: window.contextVars.currentUser,
        pageTitle: window.contextVars.node.title
    };
    Comment.init('#commentsLink', '.comment-pane', options);
}
var institutionLogos = {
    controller: function(args){
        var self = this;
        self.institutions = args.institutions;
        self.nLogos = self.institutions.length;
        self.side = self.nLogos > 1 ? (self.nLogos === 2 ? '50px' : '35px') : '75px';
        self.width = self.nLogos > 1 ? (self.nLogos === 2 ? '115px' : '86px') : '75px';
        self.makeLogo = function(institution){
            return m('a', {href: '/institutions/' + institution.id},
                m('img.img-circle', {
                    height: self.side, width: self.side,
                    style: {margin: '3px'},
                    title: institution.name,
                    src: institution.logo_path
                })
            );
        };
    },
    view: function(ctrl, args){
        var tooltips = function(){
            $('[data-toggle="tooltip"]').tooltip();
        };
        var instCircles = $.map(ctrl.institutions, ctrl.makeLogo);
        if (instCircles.length > 4){
            instCircles[3] = m('.fa.fa-plus-square-o', {
                style: {margin: '6px', fontSize: '250%', verticalAlign: 'middle'},
            });
            instCircles.splice(4);
        }

        return m('', {style: {float: 'left', width: ctrl.width, textAlign: 'center', marginRight: '10px'}, config: tooltips}, instCircles);
    }
};

// Load categories to pass in to create project
var loadCategories = function() {
    var deferred = m.deferred();
    var errorMsg;
    $osf.ajaxJSON('OPTIONS', $osf.apiV2Url('nodes/', { query : {}}), {isCors: true})
        .then(function _success(results){
            if(results.actions && lodashGet(results, 'actions.POST.category.choices', []).length) {
                var categoryList = results.actions.POST.category.choices;
                categoryList.sort(function(a, b){ // Quick alphabetical sorting
                    if(a.display_name < b.display_name) return -1;
                    if(a.display_name > b.display_name) return 1;
                    return 0;
                });
                deferred.resolve(categoryList);
            } else {
                errorMsg = 'API returned a success response, but no categories were returned';
                Raven.captureMessage(errorMsg, {extra: {response: results}});
                deferred.reject(errorMsg);
            }
        }, function _error(results){
            errorMsg = 'Error loading project category names.';
            Raven.captureMessage(errorMsg, {extra: {response: results}});
            deferred.reject(errorMsg);
        });
    return deferred.promise;
};

loadCategories().then(function(categories) {
    categoryList(categories);
});

$(document).ready(function () {

    if (ctx.node.institutions.length && !ctx.node.anonymous){
        m.mount(document.getElementById('instLogo'), m.component(institutionLogos, {institutions: window.contextVars.node.institutions}));
    }
    $('#contributorsList').osfToggleHeight();

    if (!ctx.node.isRetracted) {
        // Recent Activity widget
        m.mount(document.getElementById('logFeed'), m.component(LogFeed.LogFeed, {node: node}));

        // Treebeard Files view
        $.ajax({
            url:  nodeApiUrl + 'files/grid/'
        }).done(function (data) {
            var fangornOpts = {
                divID: 'treeGrid',
                filesData: data.data,
                uploads : true,
                showFilter : true,
                placement: 'dashboard',
                title : undefined,
                filterFullWidth : true, // Make the filter span the entire row for this view
                xhrconfig: $osf.setXHRAuthorization,
                columnTitles : function () {
                    return [
                        {
                            title: 'Name',
                            width : '70%',
                            sort : true,
                            sortType : 'text'
                        },
                        {
                            title: 'Modified',
                            width : '30%',
                            sort : true,
                            sortType : 'text'
                        }
                    ];
                },
                resolveRows : function (item) {
                    var tb = this;
                    item.css = '';
                    if(tb.isMultiselected(item.id)){
                        item.css = 'fangorn-selected';
                    }
                    if(item.data.permissions && !item.data.permissions.view){
                        item.css += ' tb-private-row';
                    }
                    var defaultColumns = [
                                {
                                data: 'name',
                                folderIcons: true,
                                filter: true,
                                custom: Fangorn.DefaultColumns._fangornTitleColumn},
                                {
                                data: 'modified',
                                folderIcons: false,
                                filter: false,
                                custom: Fangorn.DefaultColumns._fangornModifiedColumn
                            }];
                    if (item.parentID) {
                        item.data.permissions = item.data.permissions || item.parent().data.permissions;
                        if (item.data.kind === 'folder') {
                            item.data.accept = item.data.accept || item.parent().data.accept;
                        }
                    }
                    if(item.data.uploadState && (item.data.uploadState() === 'pending' || item.data.uploadState() === 'uploading')){
                        return Fangorn.Utils.uploadRowTemplate.call(tb, item);
                    }

                    var configOption = Fangorn.Utils.resolveconfigOption.call(this, item, 'resolveRows', [item]);
                    return configOption || defaultColumns;
                }
            };
            var filebrowser = new Fangorn(fangornOpts);
        });
    }

    // Tooltips
    $('[data-toggle="tooltip"]').tooltip({container: 'body'});

    // Tag input
    $('#node-tags').tagsInput({
        width: '100%',
        interactive: window.contextVars.currentUser.canEdit,
        maxChars: 128,
        onAddTag: function(tag) {
            var url = nodeApiUrl + 'tags/';
            var data = {tag: tag};
            var request = $osf.postJSON(url, data);
            request.fail(function(xhr, textStatus, error) {
                Raven.captureMessage('Failed to add tag', {
                    extra: {
                        tag: tag, url: url, textStatus: textStatus, error: error
                    }
                });
            });
        },
        onRemoveTag: function(tag) {
            var url = nodeApiUrl + 'tags/';
            // Don't try to delete a blank tag (would result in a server error)
            if (!tag) {
                return false;
            }
            var request = $osf.ajaxJSON('DELETE', url, {'data': {'tag': tag}});
            request.fail(function(xhr, textStatus, error) {
                // Suppress "tag not found" errors, as the end result is what the user wanted (tag is gone)- eg could be because two people were working at same time
                if (xhr.status !== 409) {
                    $osf.growl('Error', 'Could not remove tag');
                    Raven.captureMessage('Failed to remove tag', {
                        extra: {
                            tag: tag, url: url, textStatus: textStatus, error: error
                        }
                    });
                }
            });
        }
    });

    $('#addPointer').on('shown.bs.modal', function(){
        if(!$osf.isIE()){
            $('#addPointer input').focus();
        }
    });

    // Limit the maximum length that you can type when adding a tag
    $('#node-tags_tag').attr('maxlength', '128');

    // Wiki widget markdown rendering
    if (ctx.wikiWidget) {
        // Render math in the wiki widget
        var markdownElement = $('#markdownRender');
        mathrender.mathjaxify(markdownElement);

        // Render the raw markdown of the wiki
        if (!ctx.usePythonRender) {
            var request = $.ajax({
                url: ctx.urls.wikiContent
            });
            request.done(function(resp) {
                var rawText = resp.wiki_content || '*No wiki content*';
                var renderedText = md.render(rawText);
                var truncatedText = $.truncate(renderedText, {length: 400});
                markdownElement.html(truncatedText);
                mathrender.mathjaxify(markdownElement);
            });
        }
    }

    // Remove delete UI if not contributor
    if (!window.contextVars.currentUser.canEdit || window.contextVars.node.isRegistration) {
        $('a[title="Removing tag"]').remove();
        $('span.tag span').each(function(idx, elm) {
            $(elm).text($(elm).text().replace(/\s*$/, ''));
        });
    }

    if (window.contextVars.node.isRegistration && window.contextVars.node.tags.length === 0) {
        $('div.tags').remove();
    }
    $('a.btn').mouseup(function(){
        $(this).blur();
    });
});
