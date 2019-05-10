const escomplex = require('typhonjs-escomplex');
const glob = require('glob');
const fse = require('fs-extra');
const process = require('process');
const json2csv = require('json-2-csv');
const _ = require('lodash');
const mathjs = require('mathjs');
const moment = require('moment');

function calculateModuleCyclomatic(modules) {
    const cyclomatic = modules.map(module => module.aggregate.cyclomatic);
    const aggregate = cyclomatic.reduce((memo, current) => memo + current, 0);
    return {
        aggregate,
        average: modules.length ? aggregate / modules.length : 0,
    };
}

function calculateModuleHalstead(modules) {
    const halstead = modules.map(module => module.aggregate.halstead);
    const aggregateBugs = halstead.reduce(
        (memo, current) => memo + current.bugs,
        0
    );
    const aggregateTime = halstead.reduce(
        (memo, current) => memo + current.bugs,
        0
    );

    return {
        aggregateBugs,
        averageBugs: halstead.length ? aggregateBugs / halstead.length : 0,
        aggregateTime,
        averageTime: halstead.length ? aggregateTime / halstead.length : 0,
    };
}

/**
 * Creates a function that will run on every method inside of a module, even those inside classes.
 * @param {Function} callback
 * @returns {Function}
 */
function makeAllMethodStatsCallback(callback) {
    return module => {
        // classes
        const classMethodComplexities = module.classes.map(c =>
            callback(c.methods, module.filePath)
        );
        const methodComplexities = callback(module.methods, module.filePath);

        return classMethodComplexities.concat(methodComplexities);
    };
}

/**
 * Calculates common statistics
 * @param {Arry} modules
 */
function calculateCyclomaticStats(modules = []) {
    const getMethodComplexities = methods =>
        methods.map(method => method.cyclomatic);

    const allMethodComplexities = modules.map(
        makeAllMethodStatsCallback(getMethodComplexities)
    );
    const flattedComplexities = _.flattenDeep(allMethodComplexities);
    let median, max, sd, mean, thirdQuartile, meanScaled;
    if (flattedComplexities.length) {
        median = mathjs.median(flattedComplexities);
        max = mathjs.max(flattedComplexities);
        sd = mathjs.std(flattedComplexities);
        mean = mathjs.mean(flattedComplexities);
        thirdQuartile = mathjs.quantileSeq(flattedComplexities, 0.75);
        meanScaled = Math.pow(
            mathjs.mean(flattedComplexities.map(a => Math.pow(a, 4))),
            1 / 4
        );
    }
    return {
        median,
        thirdQuartile,
        max,
        sd,
        mean,
        meanScaled,
    };
}

/**
 * Count number of methods root module and in contained classes
 * @param {Array} modules
 */
function totalMethodsCount(modules = []) {
    const countMethodsFunc = methods => methods.length;
    const allMethodCounts = modules.map(
        makeAllMethodStatsCallback(countMethodsFunc)
    );
    const flattedMethodCounts = _.flattenDeep(allMethodCounts);
    return flattedMethodCounts.reduce((memo, current) => memo + current, 0);
}

function calculateAggregates(modules = [], moduleAverage = {}) {
    const totalMethods = totalMethodsCount(modules);
    const effort =
        totalMethods * _.get(moduleAverage, 'methodAverage.halstead.effort', 0);
    const lloc =
        totalMethods * _.get(moduleAverage, 'methodAverage.sloc.logical', 0);

    return {
        totalMethods,
        effort,
        lloc,
    };
}

/**
 * This performs the same calculation as the escomplex module, but this can be used with aggregates and scaled cyclomatic values
 * @param {Number} effort
 * @param {Number} cyclomatic
 * @param {Number} lloc
 */
function calculateMaintainability(effort, cyclomatic, lloc) {
    return (
        171 -
        3.42 * Math.log(effort) -
        (0.23 * cyclomatic === 0 ? 0 : Math.log(cyclomatic)) -
        16.2 * Math.log(lloc)
    );
}

function simpleSynthesisDir(data) {
    if (!data) {
        return {};
    }

    const cyclomaticStats = calculateCyclomaticStats(data.modules);

    // const halstead = calculateModuleHalstead(data.modules);
    const aggregates = calculateAggregates(data.modules, data.moduleAverage);

    return {
        // fileCount: data.modules.length,
        methodCount: aggregates.totalMethods,
        maintainability: data.moduleAverage.maintainability,
        averageScaledCyclomatic: cyclomaticStats.meanScaled,
        averageCyclomaticDensity:
            data.moduleAverage.methodAverage.cyclomaticDensity,
        aggregateEffort: aggregates.effort,
        MethodAverageEffort: data.moduleAverage.methodAverage.halstead.effort,
        maxCyclomatic: cyclomaticStats.max,
        averageCyclomatic: cyclomaticStats.mean,
        MethodAverageLloc: data.moduleAverage.methodAverage.sloc.logical,
    };
}

function complexSynthesisDir(data) {
    if (!data) {
        return {};
    }

    const getMethodStats = (methods, filePath) =>
        methods.map(method => {
            const {
                cyclomatic,
                cyclomaticDensity,
                sloc,
                halstead,
                name,
            } = method;
            const { effort } = halstead;
            const { logical } = sloc;
            return {
                filePath,
                name,
                cyclomatic,
                cyclomaticDensity,
                effort,
                lloc: logical,
            };
        });

    const allMethodStats = data.modules.map(
        makeAllMethodStatsCallback(getMethodStats)
    );
    return _.flattenDeep(allMethodStats);
}

function sourceForDir(dir) {
    const files = glob.sync(`${dir}**/!(style).@(js|jsx)`);
    return files.map(f => ({
        filePath: f,
        srcPath: f,
        code: fse.readFileSync(f, 'utf8'),
    }));
}

function simpleReportsForDir(dir) {
    const source = sourceForDir(dir);
    const result = escomplex.analyzeProject(source, {});
    return {
        dir: dir.replace('./src/', '').replace('/', ''),
        ...simpleSynthesisDir(result),
    };
}

function detailedReportsForDir(dir) {
    const source = sourceForDir(dir);
    const result = escomplex.analyzeProject(source, {});
    return complexSynthesisDir(result);
}

/**
 *  Main entry script for calculating statistics on all components.
 *  Groups code by directory to compare across components, throws away directories with no components, such as locale.
 *  Creates 1 json file and 1 csv file.
 */
function complexityAll() {
    const dirs = glob.sync('./src/*/');

    const results = dirs.map(dir => simpleReportsForDir(dir));
    const filteredResults = results.filter(result => result.methodCount);

    const timestamp = moment().unix();
    const filename = `components-${timestamp}`;

    const json = {
        timestamp,
        results: filteredResults,
    };

    fse.writeJSONSync(`./complexity-reports/${filename}.json`, json, {
        spaces: '\t',
    });

    json2csv.json2csv(filteredResults, (err, csv) => {
        if (err) {
            // eslint-disable-next-line no-console
            console.error(err);
            return;
        }
        fse.outputFileSync(`./complexity-reports/${filename}.csv`, csv);
    });
}

/**
 *  Entry script for calculating statistics on all a single component.
 *  This will produce a more detailed report showing statistics for individual methods
 *  Creates 1 json file and 1 csv file.
 */
function complexityBreakdown(component) {
    const dirs = glob.sync(`./src/${component}/`);

    if (!dirs.length) {
        throw new Error('no component');
    }

    const results = detailedReportsForDir(dirs[0]);
    const timestamp = moment().unix();
    const filename = `${component}-${timestamp}`;

    const json = {
        timestamp,
        results,
    };

    fse.writeJSONSync(`./complexity-reports/${filename}.json`, json, {
        spaces: '\t',
    });
    json2csv.json2csv(results, (err, csv) => {
        if (err) {
            // eslint-disable-next-line no-console
            console.error(err);
            return;
        }
        fse.outputFileSync(`./complexity-reports/${filename}.csv`, csv);
    });
}

const component = process.argv[2];

if (!component) {
    complexityAll();
} else {
    complexityBreakdown(component);
}
