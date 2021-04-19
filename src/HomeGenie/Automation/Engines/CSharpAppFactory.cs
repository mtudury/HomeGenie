﻿/*
    This file is part of HomeGenie Project source code.

    HomeGenie is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    HomeGenie is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with HomeGenie.  If not, see <http://www.gnu.org/licenses/>.
*/

/*
 *     Author: Generoso Martello <gene@homegenie.it>
 *     Project Homepage: http://homegenie.it
 */

using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Collections.Generic;


#if NETCOREAPP
using System.Diagnostics;
using System.Dynamic;
using System.Net;
using System.Threading;
using HomeGenie.Service;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.Emit;
using Microsoft.CSharp.RuntimeBinder;
#else
using Microsoft.CSharp;
using System.CodeDom.Compiler;
using System.Collections.Generic;
#endif

namespace HomeGenie.Automation.Engines
{
    public static class CSharpAppFactory
    {
        public const int ConditionCodeOffset = 8;

        public static Regex DynIncludes = new System.Text.RegularExpressions.Regex(@"^//@using ([^ ]+);$", RegexOptions.Compiled | RegexOptions.Multiline);
        public static Regex DynReferences = new System.Text.RegularExpressions.Regex(@"^//@reference ([^ \n]+)$", RegexOptions.Compiled | RegexOptions.Multiline);


        // TODO: move this to a config file
        private static readonly string[] Includes =
        {
            "System",
            "System.Text",
            "System.Globalization",
            "System.IO",
            "System.Linq",
            "System.Collections.Generic",
            "System.Dynamic",
            "System.Net",
            "System.Threading",
            "System.Security.Cryptography",
            "System.Security.Cryptography.X509Certificates",
            "Newtonsoft.Json",
            "Newtonsoft.Json.Linq",
            "HomeGenie",
            "HomeGenie.Service",
            "HomeGenie.Service.Logging",
            "HomeGenie.Automation",
            "HomeGenie.Data",
            "NetClientLib",
            "MIG",
            "CM19Lib", "X10 = CM19Lib.X10",
            "Innovative.Geometry",
            "Innovative.SolarCalculator",
            "LiteDB",
            "OpenSource.UPnP",
            "Raspberry",
            "Raspberry.Timers",
            "Raspberry.IO",
            "Raspberry.IO.Components.Controllers.Pca9685",
            "Raspberry.IO.Components.Controllers.Tlc59711",
            "Raspberry.IO.Components.Converters.Mcp3002",
            "Raspberry.IO.Components.Converters.Mcp3008",
            "Raspberry.IO.Components.Converters.Mcp4822",
            "Raspberry.IO.Components.Displays.Hd44780",
            "Raspberry.IO.Components.Displays.Ssd1306",
            "Raspberry.IO.Components.Displays.Ssd1306.Fonts",
            "Raspberry.IO.Components.Displays.Sda5708",
            "Raspberry.IO.Components.Expanders.Mcp23017",
            "Raspberry.IO.Components.Expanders.Pcf8574",
            "Raspberry.IO.Components.Expanders.Mcp23008",
            "Raspberry.IO.Components.Leds.GroveBar",
            "Raspberry.IO.Components.Leds.GroveRgb",
            "Raspberry.IO.Components.Sensors",
            "Raspberry.IO.Components.Sensors.Distance.HcSr04",
            "Raspberry.IO.Components.Sensors.Pressure.Bmp085",
            "Raspberry.IO.Components.Sensors.Temperature.Dht",
            "Raspberry.IO.Components.Sensors.Temperature.Tmp36",
            "Raspberry.IO.Components.Devices.PiFaceDigital",
            "Raspberry.IO.GeneralPurpose",
            "Raspberry.IO.GeneralPurpose.Behaviors",
            "Raspberry.IO.GeneralPurpose.Configuration",
            "Raspberry.IO.InterIntegratedCircuit",
            "Raspberry.IO.SerialPeripheralInterface",
            "Utility = HomeGenie.Service.Utility"
        };

        public static int ProgramCodeOffset => Includes.Count() + 15;

#if NETCOREAPP
        public static EmitResult CompileScript(string scriptSetup, string scriptSource, string outputDllFile)
#else
        public static CompilerResults CompileScript(string scriptSetup, string scriptSource, string outputDllFile)
#endif
        {
            var source = @"# pragma warning disable 0168 // variable declared but not used.
# pragma warning disable 0219 // variable assigned but not used.
# pragma warning disable 0414 // private field assigned but not used.

{using}

namespace HomeGenie.Automation.Scripting
{
    [Serializable]
    public class ScriptingInstance : ScriptingHost
    {
        private void RunCode(string PROGRAM_OPTIONS_STRING)
        {
//////////////////////////////////////////////////////////////////
// NOTE: user code start line is 16 *** please add new code after this method, do not alter start line! ***
{source}
//////////////////////////////////////////////////////////////////
        }

        #pragma warning disable 0162
        private bool SetupCode()
        {
//////////////////////////////////////////////////////////////////
// NOTE: user code start line is ??? *** please add new code after this method, do not alter start line! ***
{setup}
//////////////////////////////////////////////////////////////////
            return false;
        }
        #pragma warning restore 0162

        private HomeGenie.Automation.MethodRunResult Run(string PROGRAM_OPTIONS_STRING)
        {
            Exception ex = null;
            try
            {
                RunCode(PROGRAM_OPTIONS_STRING);
            }
            catch (Exception e)
            {
                ex = e;
            }
            return new HomeGenie.Automation.MethodRunResult(){ Exception = ex, ReturnValue = null };
        }

        private HomeGenie.Automation.MethodRunResult Setup()
        {
            Exception ex = null;
            bool retval = false;
            try
            {
                retval = SetupCode();
            }
            catch (Exception e)
            {
                ex = e;
            }
            return new HomeGenie.Automation.MethodRunResult(){ Exception = ex, ReturnValue = retval };
        }

        public ScriptingHost hg { get { return (ScriptingHost)this; } }
    }
}";

            // Dynamic References and Usings
            var additionalusings = DynIncludes.Matches(scriptSetup);
            string moreusings = "";
            foreach (Match match in additionalusings) {
                moreusings += String.Format("using {0}; ", match.Groups[1]);
            }

            var usingNs = String.Join(" ", Includes.Select(x => String.Format("using {0}; " + Environment.NewLine, x)));
            source = source
                .Replace("{using}", usingNs + moreusings)
                .Replace("{source}", scriptSource)
                .Replace("{setup}", scriptSetup);
            
            if (scriptSetup.StartsWith("//@rawcsharpscript"))
            {
                source = scriptSource;
            }


            var addregexreferences = DynReferences.Matches(scriptSetup);
            var addreferences = new List<String>();
            foreach (Match match in addregexreferences) {
                addreferences.Add(match.Groups[1].ToString());
            }
            // End Dynamic References and Usings

#if NETCOREAPP
            var dotNetCoreDir = Path.GetDirectoryName(typeof(object).GetTypeInfo().Assembly.Location);
            var homeGenieDir = Path.GetDirectoryName(typeof(HomeGenieService).GetTypeInfo().Assembly.Location);
            var compilation = CSharpCompilation.Create("a")
                .WithOptions(new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary))
                .AddReferences(

                    MetadataReference.CreateFromFile(typeof(object).GetTypeInfo().Assembly.Location),
                    MetadataReference.CreateFromFile(typeof(Enum).GetTypeInfo().Assembly.Location),
                    MetadataReference.CreateFromFile(typeof(Console).GetTypeInfo().Assembly.Location),
                    MetadataReference.CreateFromFile(typeof(Queryable).GetTypeInfo().Assembly.Location),
                    MetadataReference.CreateFromFile(typeof(Uri).GetTypeInfo().Assembly.Location),
                    MetadataReference.CreateFromFile(typeof(HttpListener).GetTypeInfo().Assembly.Location),
                    MetadataReference.CreateFromFile(typeof(DynamicObject).GetTypeInfo().Assembly.Location),
                    MetadataReference.CreateFromFile(Path.Combine(dotNetCoreDir, "System.Runtime.dll")),
                    MetadataReference.CreateFromFile(Assembly.Load("netstandard").Location),
                    MetadataReference.CreateFromFile(Assembly.Load("mscorlib").Location),
                    MetadataReference.CreateFromFile(typeof(Thread).GetTypeInfo().Assembly.Location),
                    MetadataReference.CreateFromFile(typeof(Stopwatch).GetTypeInfo().Assembly.Location),
                    MetadataReference.CreateFromFile(typeof(System.Linq.Enumerable).GetTypeInfo().Assembly.Location),
                    MetadataReference.CreateFromFile(Path.Combine(dotNetCoreDir, "System.Windows.dll")),
                    MetadataReference.CreateFromFile(Path.Combine(dotNetCoreDir, "System.Threading.Thread.dll")),
                    MetadataReference.CreateFromFile(Path.Combine(dotNetCoreDir, "System.Collections.dll")),
                    MetadataReference.CreateFromFile(Path.Combine(dotNetCoreDir, "System.Net.dll")),
                    MetadataReference.CreateFromFile(Path.Combine(dotNetCoreDir, "System.Net.Primitives.dll")),
                    MetadataReference.CreateFromFile(Path.Combine(dotNetCoreDir, "System.Net.NameResolution.dll")),
                    MetadataReference.CreateFromFile(Path.Combine(homeGenieDir, "HomeGenie.dll")),

                    MetadataReference.CreateFromFile(Path.Combine(dotNetCoreDir, "System.dll")),
                    MetadataReference.CreateFromFile(Path.Combine(dotNetCoreDir, "System.Core.dll")),
                    MetadataReference.CreateFromFile(typeof(CSharpArgumentInfo).GetTypeInfo().Assembly.Location),

                    MetadataReference.CreateFromFile(Path.Combine(homeGenieDir, "MIG.dll")),
                    MetadataReference.CreateFromFile(Path.Combine(homeGenieDir,
                        Path.Combine("lib", "mig", "CM19Lib.dll"))),
                    MetadataReference.CreateFromFile(Path.Combine(homeGenieDir, "LiteDB.dll")),
                    MetadataReference.CreateFromFile(Path.Combine(homeGenieDir, "NLog.dll")),
                    MetadataReference.CreateFromFile(Path.Combine(homeGenieDir, "Newtonsoft.Json.dll")),
                    MetadataReference.CreateFromFile(Path.Combine(homeGenieDir, "SerialPortLib.dll")),
                    MetadataReference.CreateFromFile(Path.Combine(homeGenieDir, "NetClientLib.dll")),
                    MetadataReference.CreateFromFile(Path.Combine(homeGenieDir, "UPnP.dll")),
                    MetadataReference.CreateFromFile(Path.Combine(homeGenieDir, "MQTTnet.dll")),
                    MetadataReference.CreateFromFile(Path.Combine(homeGenieDir, "Raspberry.IO.dll")),
                    MetadataReference.CreateFromFile(Path.Combine(homeGenieDir, "Raspberry.IO.Components.dll")),
                    MetadataReference.CreateFromFile(Path.Combine(homeGenieDir, "Raspberry.IO.GeneralPurpose.dll")),
                    MetadataReference.CreateFromFile(Path.Combine(homeGenieDir,
                        "Raspberry.IO.InterIntegratedCircuit.dll")),
                    MetadataReference.CreateFromFile(Path.Combine(homeGenieDir,
                        "Raspberry.IO.SerialPeripheralInterface.dll")),
                    MetadataReference.CreateFromFile(Path.Combine(homeGenieDir, "Raspberry.System.dll")),
                    MetadataReference.CreateFromFile(Path.Combine(homeGenieDir, "Innovative.Geometry.Angle.dll")),
                    MetadataReference.CreateFromFile(Path.Combine(homeGenieDir, "Innovative.SolarCalculator.dll"))
                )
                .AddSyntaxTrees(CSharpSyntaxTree.ParseText(source));

            foreach (var refe in addreferences)
            {
                compilation = compilation.AddReferences(MetadataReference.CreateFromFile(refe));
            }

            var assemblyPdbFile = outputDllFile + ".pdb";
            using var assemblyStream = File.Open(outputDllFile, FileMode.Create, FileAccess.ReadWrite);
            using var pdbStream = File.Open(assemblyPdbFile, FileMode.Create, FileAccess.ReadWrite);
            var opts = new EmitOptions()
                .WithPdbFilePath(assemblyPdbFile);
            var pdbStreamHelper = pdbStream;

            if (Environment.OSVersion.Platform == PlatformID.Unix)
                opts = opts.WithDebugInformationFormat(DebugInformationFormat.PortablePdb);

            var result = compilation.Emit(assemblyStream, pdbStreamHelper, options: opts);

            if (result.Success)
            {
                Console.WriteLine("Compilation : Success");
                // TODO:
            }
            else
            {
                // TODO:
                Console.WriteLine("Compilation : Not Success !");
                foreach (var item in result.Diagnostics)
                {
                    Console.WriteLine(item.ToString());
                }
            }
            return result;
#else
            var providerOptions = new Dictionary<string, string>
            {
                //{ "CompilerVersion", "v4.0" }
            };
            var provider = new CSharpCodeProvider(providerOptions);
            var compilerParams = new CompilerParameters
            {
                GenerateInMemory = false,
                GenerateExecutable = false,
                IncludeDebugInformation = true,
                TreatWarningsAsErrors = false,
                OutputAssembly = outputDllFile
                // *** Useful for debugging
                //,TempFiles = new TempFileCollection {KeepFiles = true}
            };

            // Mono runtime 2/3 compatibility fix
            // TODO: this may not be required anymore
            var relocateSystemAsm = false;
            var type = Type.GetType("Mono.Runtime");
            if (type != null)
            {
                MethodInfo displayName = type.GetMethod("GetDisplayName", BindingFlags.NonPublic | BindingFlags.Static);
                if (displayName != null)
                {
                    int major;
                    if (Int32.TryParse(displayName.Invoke(null, null).ToString().Substring(0, 1), out major) && major > 2)
                    {
                        relocateSystemAsm = true;
                    }
                }
            }
            if (!relocateSystemAsm)
            {
                var assemblies = AppDomain.CurrentDomain.GetAssemblies();
                foreach (var assembly in assemblies)
                {
                    var assemblyName = assembly.GetName();
                    switch (assemblyName.Name.ToLower())
                    {
                        case "system":
                            compilerParams.ReferencedAssemblies.Add(assembly.Location);
                            break;
                        case "system.core":
                            compilerParams.ReferencedAssemblies.Add(assembly.Location);
                            break;
                        case "microsoft.csharp":
                            compilerParams.ReferencedAssemblies.Add(assembly.Location);
                            break;
                    }
                }
            }
            else
            {
                compilerParams.ReferencedAssemblies.Add("System.dll");
                compilerParams.ReferencedAssemblies.Add("System.Core.dll");
                compilerParams.ReferencedAssemblies.Add("Microsoft.CSharp.dll");
            }

            compilerParams.ReferencedAssemblies.Add("HomeGenie.exe");
            compilerParams.ReferencedAssemblies.Add("MIG.dll");
            compilerParams.ReferencedAssemblies.Add(Path.Combine("lib", "mig", "CM19Lib.dll"));
            compilerParams.ReferencedAssemblies.Add("LiteDB.dll");
            compilerParams.ReferencedAssemblies.Add("NLog.dll");
            compilerParams.ReferencedAssemblies.Add("Newtonsoft.Json.dll");

            compilerParams.ReferencedAssemblies.Add("SerialPortLib.dll");
            compilerParams.ReferencedAssemblies.Add("NetClientLib.dll");


            compilerParams.ReferencedAssemblies.Add("UPnP.dll");

            compilerParams.ReferencedAssemblies.Add("MQTTnet.dll");

            //if (Raspberry.Board.Current.IsRaspberryPi)
            {
                compilerParams.ReferencedAssemblies.Add("Raspberry.IO.dll");
                compilerParams.ReferencedAssemblies.Add("Raspberry.IO.Components.dll");
                compilerParams.ReferencedAssemblies.Add("Raspberry.IO.GeneralPurpose.dll");
                compilerParams.ReferencedAssemblies.Add("Raspberry.IO.InterIntegratedCircuit.dll");
                compilerParams.ReferencedAssemblies.Add("Raspberry.IO.SerialPeripheralInterface.dll");
                compilerParams.ReferencedAssemblies.Add("Raspberry.System.dll");
            }

            compilerParams.ReferencedAssemblies.Add(Path.Combine("Innovative.Geometry.Angle.dll"));
            compilerParams.ReferencedAssemblies.Add(Path.Combine("Innovative.SolarCalculator.dll"));

            // compile and generate script assembly
            return provider.CompileAssemblyFromSource(compilerParams, source);
#endif
        }
    }
}